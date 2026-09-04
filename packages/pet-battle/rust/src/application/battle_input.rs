use std::sync::mpsc::{Receiver, SendError, Sender, channel};

use crate::domain::PetRarity;

/// 다른 팀의 펫·성장 모듈이 전투로 전달하는 입력 계약이다.
///
/// 전투 모듈은 XP를 스스로 만들지 않고 이 입력을 소비하기만 한다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BattleInput {
    UpsertPet {
        pet_id: String,
        display_name: String,
        rarity: PetRarity,
    },
    SetActivePet {
        pet_id: String,
    },
    GrowthXpAdded {
        pet_id: String,
        amount: u64,
    },
}

#[derive(Debug, Clone)]
pub struct BattleInputSender {
    sender: Sender<BattleInput>,
}

impl BattleInputSender {
    pub fn send(&self, input: BattleInput) -> Result<(), SendError<BattleInput>> {
        self.sender.send(input)
    }
}

#[derive(Debug)]
pub struct BattleInputReceiver {
    receiver: Receiver<BattleInput>,
}

impl BattleInputReceiver {
    #[must_use]
    pub fn drain(&self) -> Vec<BattleInput> {
        self.receiver.try_iter().collect()
    }
}

#[must_use]
pub fn battle_input_channel() -> (BattleInputSender, BattleInputReceiver) {
    let (sender, receiver) = channel();
    (
        BattleInputSender { sender },
        BattleInputReceiver { receiver },
    )
}
