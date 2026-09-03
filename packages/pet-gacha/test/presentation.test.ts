import { test } from 'node:test';
import assert from 'node:assert/strict';

import { awakeningCopy, cardInterval, highestGrade, introDuration, revealCopy } from '@pet/gacha';

test('배치 연출은 가장 높은 결과 등급을 따른다', () => {
  assert.equal(highestGrade([{ grade: 'common' }, { grade: 'rare' }]), 'rare');
  assert.equal(highestGrade([{ grade: 'rare' }, { grade: 'epic' }]), 'epic');
  assert.equal(highestGrade([{ grade: 'common' }]), 'common');
});

test('등급이 높을수록 도입과 카드 공개 간격이 길다', () => {
  assert.ok(introDuration('common') < introDuration('rare'));
  assert.ok(introDuration('rare') < introDuration('epic'));
  assert.ok(cardInterval('common') < cardInterval('rare'));
  assert.ok(cardInterval('rare') < cardInterval('epic'));
});

test('연출 문구는 색상 외에도 등급 차이를 텍스트로 전달한다', () => {
  assert.deepEqual(revealCopy('common'), {
    kicker: '새로운 인연',
    heading: '숲의 문이 열립니다',
  });
  assert.deepEqual(revealCopy('rare'), {
    kicker: '반짝이는 발견',
    heading: '푸른 룬이 깨어납니다',
  });
  assert.deepEqual(revealCopy('epic'), {
    kicker: '별이 선택한 인연',
    heading: '황금빛 숲이 응답합니다',
  });
});

test('열매가 갈라지기 전에는 문구로 결과 등급을 미리 노출하지 않는다', () => {
  assert.equal(awakeningCopy('common'), '열매 속 작은 숨결이 움직입니다');
  assert.equal(awakeningCopy('rare'), awakeningCopy('common'));
  assert.equal(awakeningCopy('epic'), awakeningCopy('common'));
});
