//! 일반 파일 command의 공통 실행 경계. 경로 검증도 job 안에서 실행한다.
use super::error::CommandResult;
use std::{
    io,
    sync::{Arc, OnceLock},
};
use tokio::sync::{Mutex, Semaphore};

pub(crate) const MAX_FS_JOBS: usize = 4;

#[derive(Clone, Copy)]
pub(crate) enum FsAccess {
    Read,
    Mutate,
}

pub(crate) struct FsExecutor {
    slots: Arc<Semaphore>,
    mutations: Arc<Mutex<()>>,
}

impl FsExecutor {
    pub(crate) fn new() -> Self {
        Self {
            slots: Arc::new(Semaphore::new(MAX_FS_JOBS)),
            mutations: Arc::new(Mutex::new(())),
        }
    }

    pub(crate) async fn run<T, F>(&self, access: FsAccess, job: F) -> CommandResult<T>
    where
        T: Send + 'static,
        F: FnOnce() -> CommandResult<T> + Send + 'static,
    {
        // 유한한 잠금 하나로 파일 별칭/폴더 이동까지 보수적으로 직렬화한다.
        // 경로 맵이 없으며 대기 중 쓰기가 blocking worker 슬롯을 점유하지 않는다.
        let mutation = match access {
            FsAccess::Read => None,
            FsAccess::Mutate => Some(self.mutations.clone().lock_owned().await),
        };
        let slot =
            self.slots.clone().acquire_owned().await.map_err(|error| {
                io::Error::other(format!("filesystem executor closed: {error}"))
            })?;
        // 반드시 spawn 전에 슬롯을 얻는다. 호출자가 취소돼도 실제 작업이 끝나기까지
        // 잠금과 슬롯은 worker가 소유한다(늦은 쓰기와 다음 쓰기의 경합 방지).
        tokio::task::spawn_blocking(move || {
            let _slot = slot;
            let _mutation = mutation;
            job()
        })
        .await
        .map_err(|error| io::Error::other(format!("filesystem worker failed: {error}")))?
    }
}

pub(crate) fn file_executor() -> &'static FsExecutor {
    static EXECUTOR: OnceLock<FsExecutor> = OnceLock::new();
    EXECUTOR.get_or_init(FsExecutor::new)
}

#[cfg(test)]
#[path = "fs_executor_tests.rs"]
mod tests;
