use super::*;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::Duration;

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}

#[test]
fn perf_executor_moves_work_off_calling_thread() {
    runtime().block_on(async {
        let caller = std::thread::current().id();
        let worker = FsExecutor::new()
            .run(FsAccess::Read, || Ok(std::thread::current().id()))
            .await
            .unwrap();
        assert_ne!(
            caller, worker,
            "filesystem must not run on async/event-loop thread"
        );
        println!("caller={caller:?} filesystem_worker={worker:?}");
    });
}

#[test]
fn perf_executor_event_loop_advances_during_slow_file_work() {
    runtime().block_on(async {
        let executor = Arc::new(FsExecutor::new());
        let finished = Arc::new(AtomicUsize::new(0));
        let seen = finished.clone();
        let (started, ready) = tokio::sync::oneshot::channel();
        let (release, blocked) = std::sync::mpsc::channel();
        let task = tokio::spawn(async move {
            executor
                .run(FsAccess::Read, move || {
                    started.send(()).unwrap();
                    blocked.recv_timeout(Duration::from_secs(2)).unwrap();
                    seen.store(1, Ordering::SeqCst);
                    Ok(())
                })
                .await
        });
        ready.await.unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        let during = finished.load(Ordering::SeqCst);
        release.send(()).unwrap();
        task.await.unwrap().unwrap();
        assert_eq!(
            during, 0,
            "independent timer was blocked until file work completed"
        );
    });
}

#[test]
fn perf_executor_limits_workers_but_allows_parallel_reads() {
    runtime().block_on(async {
        let executor = Arc::new(FsExecutor::new());
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..20 {
            let executor = executor.clone();
            let active = active.clone();
            let peak = peak.clone();
            tasks.push(tokio::spawn(async move {
                executor
                    .run(FsAccess::Read, move || {
                        let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                        peak.fetch_max(count, Ordering::SeqCst);
                        std::thread::sleep(Duration::from_millis(30));
                        active.fetch_sub(1, Ordering::SeqCst);
                        Ok(())
                    })
                    .await
            }));
        }
        for task in tasks {
            task.await.unwrap().unwrap();
        }
        assert_eq!(peak.load(Ordering::SeqCst), MAX_FS_JOBS);
        assert_eq!(active.load(Ordering::SeqCst), 0);
        println!(
            "20 requests, peak FS workers={}",
            peak.load(Ordering::SeqCst)
        );
    });
}

#[test]
fn perf_executor_mutations_are_fifo_and_failure_does_not_stall_queue() {
    runtime().block_on(async {
        let executor = Arc::new(FsExecutor::new());
        let order = Arc::new(std::sync::Mutex::new(Vec::new()));
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for index in 0..10 {
            let executor = executor.clone();
            let order = order.clone();
            let active = active.clone();
            let peak = peak.clone();
            tasks.push(tokio::spawn(async move {
                executor
                    .run(FsAccess::Mutate, move || {
                        let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                        peak.fetch_max(count, Ordering::SeqCst);
                        order.lock().unwrap().push(index);
                        std::thread::sleep(Duration::from_millis(10));
                        active.fetch_sub(1, Ordering::SeqCst);
                        if index == 3 {
                            return Err(std::io::Error::other("injected IO failure").into());
                        }
                        Ok(())
                    })
                    .await
            }));
            // 각 요청이 잠금을 신청한 순서를 고정한다(파일 처리 완료를 기다리지 않는다).
            tokio::task::yield_now().await;
        }
        for (index, task) in tasks.into_iter().enumerate() {
            assert_eq!(task.await.unwrap().is_err(), index == 3);
        }
        assert_eq!(*order.lock().unwrap(), (0..10).collect::<Vec<_>>());
        assert_eq!(peak.load(Ordering::SeqCst), 1);
        assert_eq!(active.load(Ordering::SeqCst), 0);
        println!("10 mutations: FIFO 0..9, peak=1, failure at 3 did not stall 4..9");
    });
}

#[test]
fn perf_executor_cancelled_caller_keeps_running_mutation_locked() {
    runtime().block_on(async {
        let executor = Arc::new(FsExecutor::new());
        let (started, ready) = tokio::sync::oneshot::channel();
        let (release, blocked) = std::sync::mpsc::channel();
        let first_executor = executor.clone();
        let first = tokio::spawn(async move {
            first_executor
                .run(FsAccess::Mutate, move || {
                    started.send(()).unwrap();
                    blocked.recv_timeout(Duration::from_secs(2)).unwrap();
                    Ok(())
                })
                .await
        });
        ready.await.unwrap();
        first.abort();
        assert!(first.await.unwrap_err().is_cancelled());
        let seen = Arc::new(AtomicUsize::new(0));
        let next_seen = seen.clone();
        let second = tokio::spawn(async move {
            executor
                .run(FsAccess::Mutate, move || {
                    next_seen.store(1, Ordering::SeqCst);
                    Ok(())
                })
                .await
        });
        tokio::time::sleep(Duration::from_millis(30)).await;
        let before_release = seen.load(Ordering::SeqCst);
        release.send(()).unwrap();
        second.await.unwrap().unwrap();
        assert_eq!(
            before_release, 0,
            "caller cancellation released a still-running write"
        );
        assert_eq!(seen.load(Ordering::SeqCst), 1);
    });
}

#[test]
fn perf_executor_worker_panic_is_error_and_releases_permits() {
    runtime().block_on(async {
        let executor = FsExecutor::new();
        let result: CommandResult<()> = executor
            .run(FsAccess::Mutate, || {
                panic!("injected worker panic");
            })
            .await;
        assert!(result.is_err());
        executor.run(FsAccess::Mutate, || Ok(())).await.unwrap();
    });
}
