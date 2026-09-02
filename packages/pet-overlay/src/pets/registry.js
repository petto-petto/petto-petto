// 펫 도트 에셋 레지스트리 — 담당자 제공 pets/ 소비 계약 (원본: pets/README.md).
// 자산 경로: pets/{grade소문자}/{slug}/stage{N}/pet_{petId}_s{N}_{motion}.png (+ .json 메타)
// public/pets/ 에 복사되어 dev='/pets', prod(file://)='dist/pets' 로 서빙됨(base './').

export const ASSET_ROOT = 'pets';

// 6종 (petId 001~006). README §2 표 + 이후 추가분(sprout_treant/cheek_hamster/star_wizard).
export const PETS = [
  { key: 'mole_digger',    petId: '003', slug: 'mole_digger',    grade: 'COMMON', name: '두더지' },
  { key: 'sprout_treant',  petId: '004', slug: 'sprout_treant',  grade: 'COMMON', name: '새싹나무' },
  { key: 'cheek_hamster',  petId: '005', slug: 'cheek_hamster',  grade: 'RARE',   name: '볼주머니햄' },
  { key: 'midnight_zebra', petId: '002', slug: 'midnight_zebra', grade: 'RARE',   name: '미드나잇얼룩말' },
  { key: 'acorn_squirrel', petId: '001', slug: 'acorn_squirrel', grade: 'EPIC',   name: '도토리다람쥐' },
  { key: 'star_wizard',    petId: '006', slug: 'star_wizard',    grade: 'EPIC',   name: '별빛마법사' },
];

export const DEFAULT_PET_KEY = 'mole_digger';
export function getPet(key) { return PETS.find((p) => p.key === key) || PETS[0]; }

// 우리 성장 계약: 진화는 사용자가 직접 실행 → evolutionStage(0/1/2)로 스프라이트 stage(1/2/3) 결정.
// (README §3의 Lv 구간 매핑은 담당자 측 가정이며, 여기선 evolutionStage를 정답으로 둔다.)
export function stageForEvolution(evolutionStage) {
  return Math.min(3, Math.max(1, (evolutionStage || 0) + 1));
}

export const MOTIONS = ['idle', 'click', 'click2', 'attack'];

// 경로 조립 (README §1/§6)
export function spritePng(pet, stage, motion) {
  return `${ASSET_ROOT}/${pet.grade.toLowerCase()}/${pet.slug}/stage${stage}/pet_${pet.petId}_s${stage}_${motion}.png`;
}

// 클릭 반응은 click/click2 랜덤 1종 (README §0-6, §8)
export function randomClick() { return Math.random() < 0.5 ? 'click' : 'click2'; }
