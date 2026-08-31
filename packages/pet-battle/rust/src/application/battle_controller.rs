use crate::domain::{
    BattleConfig, BattleEvent, BattleMode, BattleSnapshot, PetBattleProgress, PetRarity,
};

use super::BattleInput;

#[derive(Debug, Clone, PartialEq)]
pub struct PetBattleEvent {
    pub pet_id: String,
    pub event: BattleEvent,
}

#[derive(Debug)]
pub struct BattleController {
    config: BattleConfig,
    snapshot: BattleSnapshot,
}

impl BattleController {
    #[must_use]
    pub fn new(config: BattleConfig, snapshot: BattleSnapshot) -> Self {
        Self { config, snapshot }
    }

    #[must_use]
    pub const fn config(&self) -> BattleConfig {
        self.config
    }

    #[must_use]
    pub const fn snapshot(&self) -> &BattleSnapshot {
        &self.snapshot
    }

    #[must_use]
    pub fn active_pet(&self) -> Option<&PetBattleProgress> {
        let active_id = self.snapshot.active_pet_id.as_deref()?;
        self.snapshot
            .pets
            .iter()
            .find(|pet| pet.pet_id == active_id)
    }

    #[must_use]
    pub fn pet(&self, pet_id: &str) -> Option<&PetBattleProgress> {
        self.snapshot.pets.iter().find(|pet| pet.pet_id == pet_id)
    }

    fn active_pet_mut(&mut self) -> Option<&mut PetBattleProgress> {
        let active_id = self.snapshot.active_pet_id.as_deref()?;
        self.snapshot
            .pets
            .iter_mut()
            .find(|pet| pet.pet_id == active_id)
    }

    fn pet_mut(&mut self, pet_id: &str) -> Option<&mut PetBattleProgress> {
        self.snapshot
            .pets
            .iter_mut()
            .find(|pet| pet.pet_id == pet_id)
    }

    pub fn select_pet(&mut self, pet_id: &str) -> Option<BattleEvent> {
        self.snapshot
            .pets
            .iter()
            .any(|pet| pet.pet_id == pet_id)
            .then(|| {
                self.snapshot.active_pet_id = Some(pet_id.to_owned());
                BattleEvent::ActivePetChanged(pet_id.to_owned())
            })
    }

    pub fn toggle_battle(&mut self) -> Option<BattleEvent> {
        self.active_pet_mut().map(PetBattleProgress::toggle_battle)
    }

    pub fn apply_growth_xp(&mut self, amount: u64) -> Option<BattleEvent> {
        let config = self.config;
        self.active_pet_mut()
            .map(|pet| pet.apply_growth_xp(amount, config))
    }

    pub fn apply_growth_xp_for(&mut self, pet_id: &str, amount: u64) -> Option<PetBattleEvent> {
        let config = self.config;
        self.pet_mut(pet_id).map(|pet| PetBattleEvent {
            pet_id: pet_id.to_owned(),
            event: pet.apply_growth_xp(amount, config),
        })
    }

    /// 외부 펫·성장 시스템의 입력을 전투 진행도에 반영한다.
    ///
    /// 동일한 펫을 다시 동기화해도 전투 스테이지와 누적 구간 XP는 보존한다.
    pub fn handle_input(&mut self, input: BattleInput) -> Option<PetBattleEvent> {
        match input {
            BattleInput::GrowthXpAdded { pet_id, amount } => {
                self.apply_growth_xp_for(&pet_id, amount)
            }
            BattleInput::SetActivePet { pet_id } => self
                .select_pet(&pet_id)
                .map(|event| PetBattleEvent { pet_id, event }),
            BattleInput::UpsertPet {
                pet_id,
                display_name,
                rarity,
            } => {
                if let Some(pet) = self.pet_mut(&pet_id) {
                    pet.display_name = display_name;
                    pet.rarity = rarity;
                    return None;
                }

                self.snapshot.pets.push(PetBattleProgress::new(
                    pet_id.clone(),
                    display_name,
                    rarity,
                ));
                if self.snapshot.active_pet_id.is_none() {
                    self.snapshot.active_pet_id = Some(pet_id.clone());
                    return Some(PetBattleEvent {
                        pet_id: pet_id.clone(),
                        event: BattleEvent::ActivePetChanged(pet_id),
                    });
                }
                None
            }
        }
    }

    #[must_use]
    pub fn is_fighting(&self) -> bool {
        self.active_pet()
            .is_some_and(|pet| pet.battle_mode == BattleMode::Fighting)
    }

    #[must_use]
    pub fn demo_snapshot() -> BattleSnapshot {
        BattleSnapshot {
            active_pet_id: Some("mio".to_owned()),
            pets: vec![
                PetBattleProgress::new("mio", "미오", PetRarity::Common),
                PetBattleProgress::new("lumi", "루미", PetRarity::Rare),
                PetBattleProgress::new("nova", "노바", PetRarity::Epic),
            ],
        }
    }

    #[must_use]
    pub fn demo(config: BattleConfig) -> Self {
        Self::new(config, Self::demo_snapshot())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: BattleConfig = BattleConfig {
        common_interval_xp: 120,
        rare_interval_xp: 100,
        epic_interval_xp: 80,
        attack_cycle_ms: 2_400,
        animation_fps: 10,
    };

    #[test]
    fn switching_pet_restores_each_pets_independent_stage() {
        let mut snapshot = BattleController::demo_snapshot();
        snapshot.pets[0].stage = 5;
        snapshot.pets[1].stage = 2;
        let mut controller = BattleController::new(CONFIG, snapshot);

        controller.select_pet("lumi");
        assert_eq!(controller.active_pet().map(|pet| pet.stage), Some(2));

        controller.select_pet("mio");
        assert_eq!(controller.active_pet().map(|pet| pet.stage), Some(5));
    }

    #[test]
    fn selecting_unknown_pet_keeps_current_pet() {
        let mut controller = BattleController::new(CONFIG, BattleController::demo_snapshot());

        assert_eq!(controller.select_pet("missing"), None);
        assert_eq!(
            controller.active_pet().map(|pet| pet.pet_id.as_str()),
            Some("mio")
        );
    }
}
