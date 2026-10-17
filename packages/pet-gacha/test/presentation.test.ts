import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TOKEN_HINT,
  awakeningCopy,
  cardInterval,
  drawAffordance,
  drawCost,
  highestGrade,
  introDuration,
  revealCopy,
  showsTokenHint,
} from '@pet/gacha';

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

test('잔액이 비용 이상인 소환만 누를 수 있고, 같으면 누를 수 있다', () => {
  assert.deepEqual(drawAffordance(1, 100_000), { affordable: true, label: '100,000 토큰' });
  assert.deepEqual(drawAffordance(1, 99_999), {
    affordable: false,
    label: '100,000 토큰 · 1 부족',
  });
  assert.deepEqual(drawAffordance(10, 1_000_000), {
    affordable: true,
    label: '1,000,000 토큰 · RARE 이상 보장',
  });
});

test('모자란 소환은 비용과 부족분을 함께 보인다', () => {
  assert.deepEqual(drawAffordance(10, 255_309), {
    affordable: false,
    label: '1,000,000 토큰 · 744,691 부족',
  });
  assert.equal(drawAffordance(1, 255_309).affordable, true);
});

test('어느 소환이든 모자라면 토큰을 모으는 방법을 안내한다', () => {
  assert.equal(TOKEN_HINT, 'AI 도구를 쓰면 토큰이 쌓여요.');
  assert.equal(showsTokenHint(255_309), true);
  assert.equal(showsTokenHint(0), true);
  assert.equal(showsTokenHint(1_000_000), false);
});

test('소환 비용은 한 곳에서 정한다', () => {
  assert.equal(drawCost(1), 100_000);
  assert.equal(drawCost(10), 1_000_000);
});
