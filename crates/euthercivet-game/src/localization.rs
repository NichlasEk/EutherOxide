use crate::model::{CivetProfile, GameState, InventoryItem, Language, PlantationRoom};

pub fn state_text(state: &GameState, en: &'static str, sv: &'static str) -> &'static str {
    language_text(state.language, en, sv)
}

pub fn language_text(language: Language, en: &'static str, sv: &'static str) -> &'static str {
    if language == Language::Swedish {
        sv
    } else {
        en
    }
}

pub fn room_name(room: PlantationRoom, language: Language) -> &'static str {
    if language == Language::Swedish {
        match room {
            PlantationRoom::Sanctuary => "Fristad",
            PlantationRoom::CoffeeField => "Kaffefält",
            PlantationRoom::Roastery => "Rosteri",
            PlantationRoom::PaperworkOffice => "Papperskontor",
        }
    } else {
        match room {
            PlantationRoom::Sanctuary => "Sanctuary",
            PlantationRoom::CoffeeField => "Coffee Field",
            PlantationRoom::Roastery => "Roastery",
            PlantationRoom::PaperworkOffice => "Paperwork Office",
        }
    }
}

pub fn room_name_definite(room: PlantationRoom, language: Language) -> &'static str {
    if language == Language::Swedish {
        match room {
            PlantationRoom::Sanctuary => "Fristaden",
            PlantationRoom::CoffeeField => "Kaffefältet",
            PlantationRoom::Roastery => "Rosteriet",
            PlantationRoom::PaperworkOffice => "Papperskontoret",
        }
    } else {
        room_name(room, language)
    }
}

pub fn world_label(state: &GameState, key: &'static str) -> &'static str {
    if state.language == Language::Swedish {
        match key {
            "owner" => "plantageägare",
            "fruit" => "frukt",
            "seedlings" => "plantor",
            "fruit_on_hand" => "Kaffefrukt i säcken",
            "civet_garden" => "palmmårdsträdgård",
            "binturong" => "binturong",
            "snack_trays" => "snackbrickor",
            "roaster" => "ROSTARE",
            "coffee" => "kaffe",
            "bean_crate" => "bönlåda",
            "police_helicopter" => "polishelikopter",
            "suspicion" => "Misstanke",
            "field_goat" => "fältget?",
            "goat" => "get?",
            "witness" => "vittne",
            "field_hint" => "Bästa knapparna här: Plantera kaffe, Skörda frukt, Mata palmmårdar.",
            "sanctuary_hint" => {
                "Klicka på en palmmård för att mata, klappa, granska anteckningar och bygga tillgivenhet."
            }
            "roastery_hint" => "Bästa knapparna här: Samla bönor, Rosta kaffe, Sälj kaffe.",
            "office_hint" => {
                "Bästa knapparna här: Visa papper, bygg kontorsuppgraderingar, håll dig lugn."
            }
            "processed_beans" => "Processade bönor",
            "roasted_bags" => "Rostade säckar",
            "paperwork_level" => "Pappersnivå",
            "sleepy" => "sömnig",
            "hungry" => "hungrig",
            "curious" => "nyfiken",
            "content" => "nöjd",
            "field_harvest_sign" => "Skörda frukt",
            "field_plant_sign" => "Plantera här",
            "sanctuary_feed_sign" => "Mata bricka",
            "sanctuary_beans_sign" => "Samla bönor",
            "care_brush_sign" => "Borste",
            "care_collar_sign" => "Halsband",
            "care_puzzle_sign" => "Pussel",
            "roast_sign" => "Rosta",
            "sell_sign" => "Sälj",
            "deliver_sign" => "Leverera order",
            "paperwork_sign" => "Visa papper",
            "legal_plan_sign" => "Juridik",
            "caretaker_plan_sign" => "Djurskötare",
            "sorter_plan_sign" => "Sorterare",
            "shed_plan_sign" => "Rostskjul",
            "tasting_plan_sign" => "Provning",
            _ => key,
        }
    } else {
        match key {
            "owner" => "plantation owner",
            "fruit" => "fruit",
            "seedlings" => "seedlings",
            "fruit_on_hand" => "Coffee fruit on hand",
            "civet_garden" => "civet garden",
            "binturong" => "binturong",
            "snack_trays" => "snack trays",
            "roaster" => "ROASTER",
            "coffee" => "coffee",
            "bean_crate" => "bean crate",
            "police_helicopter" => "police helicopter",
            "suspicion" => "Suspicion",
            "field_goat" => "field goat?",
            "goat" => "goat?",
            "witness" => "witness",
            "field_hint" => "Best buttons here: Plant coffee, Harvest fruit, Feed civets.",
            "sanctuary_hint" => "Click a civet to feed, pet, inspect notes, and build affection.",
            "roastery_hint" => "Best buttons here: Collect beans, Roast coffee, Sell coffee.",
            "office_hint" => "Best buttons here: Show paperwork, build office upgrades, stay calm.",
            "processed_beans" => "Processed beans",
            "roasted_bags" => "Roasted bags",
            "paperwork_level" => "Paperwork level",
            "sleepy" => "sleepy",
            "hungry" => "hungry",
            "curious" => "curious",
            "content" => "content",
            "field_harvest_sign" => "Harvest fruit",
            "field_plant_sign" => "Plant here",
            "sanctuary_feed_sign" => "Feed tray",
            "sanctuary_beans_sign" => "Collect beans",
            "care_brush_sign" => "Brush",
            "care_collar_sign" => "Collar",
            "care_puzzle_sign" => "Puzzle",
            "roast_sign" => "Roast",
            "sell_sign" => "Sell",
            "deliver_sign" => "Deliver order",
            "paperwork_sign" => "Show paperwork",
            "legal_plan_sign" => "Legal",
            "caretaker_plan_sign" => "Caretaker",
            "sorter_plan_sign" => "Sorter",
            "shed_plan_sign" => "Roast shed",
            "tasting_plan_sign" => "Tasting",
            _ => key,
        }
    }
}

pub fn care_item_name(item: InventoryItem, language: Language) -> &'static str {
    if language == Language::Swedish {
        match item {
            InventoryItem::TinyBrush => "liten borste",
            InventoryItem::RibbonCollar => "rosetthalsband",
            InventoryItem::FruitPuzzle => "fruktpussel",
        }
    } else {
        match item {
            InventoryItem::TinyBrush => "tiny brush",
            InventoryItem::RibbonCollar => "ribbon collar",
            InventoryItem::FruitPuzzle => "fruit puzzle",
        }
    }
}

pub fn civet_status_key(profile: &CivetProfile) -> &'static str {
    if profile.hunger > 78.0 {
        "civet_status_hungry"
    } else if profile.mood < 38.0 {
        "civet_status_stressed"
    } else if profile.hunger < 35.0 && profile.mood >= 72.0 {
        "civet_status_content"
    } else if profile.mood > 82.0 {
        "civet_status_curious"
    } else {
        "civet_status_settled"
    }
}

pub fn civet_status_label(profile: &CivetProfile, language: Language) -> &'static str {
    match (language, civet_status_key(profile)) {
        (Language::Swedish, "civet_status_hungry") => "Hungrig",
        (Language::Swedish, "civet_status_stressed") => "Stressad",
        (Language::Swedish, "civet_status_content") => "Nöjd",
        (Language::Swedish, "civet_status_curious") => "Nyfiken",
        (Language::Swedish, _) => "Stabil",
        (_, "civet_status_hungry") => "Hungry",
        (_, "civet_status_stressed") => "Stressed",
        (_, "civet_status_content") => "Content",
        (_, "civet_status_curious") => "Curious",
        _ => "Settled",
    }
}

pub fn civet_need_text(profile: &CivetProfile, language: Language) -> &'static str {
    match (language, civet_status_key(profile)) {
        (Language::Swedish, "civet_status_hungry") => "Behöver mat innan produktionen pressas.",
        (Language::Swedish, "civet_status_stressed") => {
            "Behöver lugn omsorg eller favoritberikning."
        }
        (Language::Swedish, "civet_status_content") => "Är redo för stabil produktion.",
        (Language::Swedish, "civet_status_curious") => {
            "Är mottaglig för berikning och positiv uppmärksamhet."
        }
        (Language::Swedish, _) => "Mår okej men kan stärkas med rätt omsorg.",
        (_, "civet_status_hungry") => "Needs food before production pressure.",
        (_, "civet_status_stressed") => "Needs calm care or favorite enrichment.",
        (_, "civet_status_content") => "Ready for stable production.",
        (_, "civet_status_curious") => "Open to enrichment and positive attention.",
        _ => "Doing okay, but the right care will help.",
    }
}
