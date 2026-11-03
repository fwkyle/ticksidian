import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshotItem, applyCardStatus, applyUserClassification, isConvertibleCard } from './src/lib/review-queue/rules.ts';

test('볼트 원본은 승인·분류 변경을 해도 새 노트로 복제되지 않는다', () => {
  const card = normalizeSnapshotItem({source:'vault-note',sourceId:'inbox/a.md',title:'a',safeContent:'원본을 열어 판단하세요.',suggestion:{classification:'정리 후보',reason:'규칙',confidence:0}}, '2026-09-05');
  assert.equal(isConvertibleCard(applyCardStatus(applyUserClassification(card,'참고','now'),'approved','now')),false);
});

test('기본함 후보는 날짜나 제목 규칙 없이 실제 md 경로를 사용한다', async () => {
  const { inboxCandidates } = await import('./src/lib/inbox-organizer.ts');
  const base={id:'metadata-id',fileBasename:'actual-name',folder:'inbox',title:'새 프로젝트',createdAt:new Date(),updatedAt:new Date()};
  assert.deepEqual(inboxCandidates([base,{...base,folder:'notes'},{...base,drawing:true},{...base,excalidrawPlugin:true}]).map(n=>n.path),['inbox/actual-name.md']);
  assert.equal(inboxCandidates([{...base,type:'todo'}]).length,1);
});

test('기존 폴더 허용 목록과 기본함 유지·잘못된 AI 응답 처리', async () => {
  const { organizerFolders, validateFolderSuggestion } = await import('./src/lib/inbox-organizer.ts');
  const node=(path,children=[])=>({path,name:path,children,isProject:false});
  const folders=organizerFolders([node('개발',[node('개발/앱')]),node('inbox'),node('archive'),node('attachments'),node('.secret'),node('../escape')]);
  assert.deepEqual(folders,['개발','개발/앱']);
  assert.deepEqual(validateFolderSuggestion({folder:'개발',reason:'앱 설계'},folders),{folder:'개발',reason:'앱 설계'});
  assert.equal(validateFolderSuggestion({folder:null,reason:'맞는 곳 없음'},folders).folder,null);
  assert.throws(()=>validateFolderSuggestion({folder:'없는 곳',reason:'x'},folders));
  assert.throws(()=>validateFolderSuggestion({folder:'../escape',reason:'x'},folders));
  assert.throws(()=>validateFolderSuggestion({folder:'개발',reason:''},folders));
});
