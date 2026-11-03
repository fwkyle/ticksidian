import { test, expect, type Page } from '@playwright/test';

const relative = 'inbox/정리 테스트.md';
const source = `/mock-vault/${relative}`;
const target = '/mock-vault/notes/정리 테스트.md';
const content = '---\nid: stable-original-id\ntitle: 정리 테스트\ntags: [설계]\n---\n\n# 앱 편집기 설계\n원본의 줄바꿈과 메타를 보존한다.\n';

async function setup(page: Page) {
  await page.goto('/');
  await expect(page.locator('.bn-editor')).toBeVisible();
  await page.evaluate(async ({source,content}) => { await window.__qa_writeVaultFile?.(source,content); }, {source,content});
  await page.reload();
  await expect(page.locator('.bn-editor')).toBeVisible();
  await page.getByRole('button',{name:'AI 정리 열기/닫기'}).click();
  await expect(page.getByRole('region',{name:'기본함 AI 정리'})).toBeVisible();
  await page.getByLabel('정리할 기본함 노트').selectOption(relative);
  await expect(page.getByRole('button',{name:'Gemini로 폴더 추천'})).toBeEnabled();
}
async function recommend(page: Page) {
  await page.getByRole('button',{name:'Gemini로 폴더 추천'}).click();
  await expect(page.getByLabel('이동할 폴더')).toHaveValue('notes');
}
async function approve(page: Page) {
  await page.getByRole('button',{name:'이동 확인',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'확인하고 이동'}).click();
}

test('원문·기존 폴더로 명시 추천, 취소는 무변경, 승인 후 원본 위치와 bytes 확인', async ({page}) => {
  await setup(page);
  expect(await page.evaluate(()=>window.__qa_inboxOrganizer.calls.length)).toBe(0);
  expect(await page.evaluate(path=>window.__qa_readVaultFile?.(path),source)).toBe(content);
  await recommend(page);
  const calls=await page.evaluate(()=>window.__qa_inboxOrganizer.calls);
  expect(calls).toHaveLength(1);
  expect(calls[0].content).toBe(content);
  expect(calls[0].folders).toContain('notes');
  expect(calls[0].folders).not.toContain('inbox');
  expect(calls[0].folders).not.toContain('attachments');
  expect(await page.evaluate(path=>window.__qa_readVaultFile?.(path),source)).toBe(content);
  await page.getByRole('button',{name:'이동 확인',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'취소',exact:true}).click();
  expect(await page.evaluate(path=>window.__qa_readVaultFile?.(path),source)).toBe(content);
  await approve(page);
  await expect(page.getByRole('region', { name: '기본함 AI 정리' }).getByRole('status')).toContainText('원본을 notes 폴더로 옮겼습니다');
  expect(await page.evaluate(path=>window.__qa_readVaultFile?.(path),target)).toBe(content);
  expect(await page.evaluate(()=>window.__qa_listVaultFiles?.())).not.toContain(source);
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof window.__qa_readVaultFile)).toBe('function');
  expect(await page.evaluate(path=>window.__qa_readVaultFile?.(path),target)).toBe(content);
  expect(await page.evaluate(()=>window.__qa_listVaultFiles?.())).not.toContain(source);
});

for (const failure of ['외부 수정','파일 충돌','권한 실패'] as const) {
  test(`${failure}이면 승인해도 원본 보존·완료 표시 없음`, async ({page}) => {
    await setup(page); await recommend(page);
    await page.evaluate(async ({failure,source,target,content})=>{
      if (failure==='외부 수정') await window.__qa_writeVaultFile?.(source,content+'외부에서 추가');
      if (failure==='파일 충돌') await window.__qa_writeVaultFile?.(target,'목적지 기존 파일');
      if (failure==='권한 실패') window.__qa_inboxOrganizer.failMove=true;
    },{failure,source,target,content});
    await approve(page);
    await expect(page.getByRole('alert')).toContainText(failure==='외부 수정'?'원본이 바뀌었습니다':failure==='파일 충돌'?'같은 이름':'권한');
    expect(await page.evaluate(path=>window.__qa_readVaultFile?.(path),source)).toBe(content+(failure==='외부 수정'?'외부에서 추가':''));
    await expect(page.getByRole('region', { name: '기본함 AI 정리' }).getByRole('status')).toHaveCount(0);
    if(failure==='파일 충돌') expect(await page.evaluate(path=>window.__qa_readVaultFile?.(path),target)).toBe('목적지 기존 파일');
  });
}

test('AI 오류·허용되지 않은 폴더는 이동 불가, 다시 요청 가능',async({page})=>{
  await setup(page);
  await page.evaluate(()=>{window.__qa_inboxOrganizer.failRecommend=true;});
  await page.getByRole('button',{name:'Gemini로 폴더 추천'}).click();
  await expect(page.getByRole('alert')).toContainText('AI 요청 실패');
  await page.evaluate(()=>{window.__qa_inboxOrganizer.failRecommend=false;window.__qa_inboxOrganizer.response={folder:'없는폴더',reason:'가짜 답변'};});
  await page.getByRole('button',{name:'Gemini로 폴더 추천'}).click();
  await expect(page.getByRole('alert')).toContainText('잘못된 폴더');
  await expect(page.getByRole('button',{name:'이동 확인',exact:true})).toHaveCount(0);
  expect(await page.evaluate(path=>window.__qa_readVaultFile?.(path),source)).toBe(content);
});

test('기본함 유지 추천과 사용자의 기존 폴더 선택',async({page})=>{
  await setup(page);
  await page.evaluate(()=>{window.__qa_inboxOrganizer.response={folder:null,reason:'맞는 곳이 없어 기본함 유지'};});
  await page.getByRole('button',{name:'Gemini로 폴더 추천'}).click();
  await expect(page.getByLabel('이동할 폴더')).toHaveValue('');
  await expect(page.getByRole('button',{name:'이동 확인',exact:true})).toBeDisabled();
  await page.getByLabel('이동할 폴더').selectOption('notes');
  await approve(page);
  await expect(page.getByRole('region', { name: '기본함 AI 정리' }).getByRole('status')).toContainText('옮겼습니다');
  expect(await page.evaluate(path=>window.__qa_readVaultFile?.(path),target)).toBe(content);
});

test('추천 대기 중 화면을 닫으면 늦은 추천을 새 화면에 붙이지 않는다',async({page})=>{
  await setup(page);
  await page.evaluate(()=>{window.__qa_inboxOrganizer.delayMs=500;});
  await page.getByRole('button',{name:'Gemini로 폴더 추천'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__qa_inboxOrganizer.calls.length)).toBe(1);
  await page.getByRole('button',{name:'AI 정리 닫기',exact:true}).click();
  await page.getByRole('button',{name:'AI 정리 열기/닫기'}).click();
  await page.waitForTimeout(600); // 제어한 지연 응답이 끝난 뒤 화면 오염 여부 확인
  // 패널에서 고른 기록이 왼쪽 선택에도 연결되어, 다시 열면 같은 원문만 읽는다.
  await expect(page.getByLabel('정리할 기본함 노트')).toHaveValue(relative);
  await expect(page.getByLabel('이동할 폴더')).toHaveCount(0);
  expect(await page.evaluate(path=>window.__qa_readVaultFile?.(path),source)).toBe(content);
});

for (const width of [375,1440]) {
  test(`AI 정리 ${width}px 다크 화면 가로 넘침·44px 조작 확인`,async({page},info)=>{
    await page.setViewportSize({width,height:900});
    await page.emulateMedia({colorScheme:'dark'});
    await setup(page); await recommend(page);
    const section=page.getByRole('region',{name:'기본함 AI 정리'});
    expect(await section.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    expect((await page.getByRole('button',{name:'이동 확인',exact:true}).boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({path:info.outputPath(`organizer-${width}.png`)});
  });
}
