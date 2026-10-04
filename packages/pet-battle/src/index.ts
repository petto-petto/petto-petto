/**
 * # @pet/battle
 *
 * 전투 feature의 수직 슬라이스다. TypeScript 엔진이 XP·정복·진행도·모션 상태와
 * Electron 화면 계약을 소유한다. 이전 JSON-lines 어댑터도 호환용으로 남긴다. 앱은 패키지의
 * 핸들러를 등록하고 UI 파일을 로드할 뿐이며 전투 규칙을 알 필요가 없다.
 */

export * from './contracts.ts';
export { ElectronBattleEngine } from './domain/engine.ts';
export type { BattleClient, BattleClientCommand } from './client.ts';
export * from './view/scene.ts';
export * from './ipc/client.ts';
export * from './ipc/sidecar.ts';
export * from './app/handlers.ts';
export * from './integration/pet-client.ts';
export * from './integration/owned-pet-gateway.ts';
export * from './integration/sprite-gateway.ts';
