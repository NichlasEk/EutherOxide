use crate::localization::{
    care_item_name, civet_need_text, civet_status_key, civet_status_label, room_name_definite,
    state_text,
};
use crate::model::{
    Action, AudioCue, DailyModifierKind, GameState, Language, PlantationRoom, RandomEventKind,
    ToolGroup,
};

pub fn run_action(state: &mut GameState, action: Action) {
    if !matches!(action, Action::Load) {
        state.cue_audio(AudioCue::UiClick);
    }

    match action {
        Action::StartGame => {
            if state.game_result.is_some() {
                let language = state.language;
                let time_scale = state.time_scale;
                *state = GameState::default();
                state.language = language;
                state.time_scale = time_scale;
            }
            state.screen = crate::model::GameScreen::Playing;
            state.log_line(state_text(
                state,
                "The plantation opens for business. Everyone looks adorable and audited.",
                "Plantagen öppnar. Alla ser bedårande och granskade ut.",
            ));
            state.log_line(state_text(
                state,
                "Plan: harvest fruit, feed civets, collect beans, roast, then sell. Check the office when mail appears.",
                "Plan: skörda frukt, mata palmmårdar, samla bönor, rosta och sälj. Kolla kontoret när post dyker upp.",
            ));
            return;
        }
        Action::StartNewRun => {
            let language = state.language;
            let time_scale = state.time_scale;
            *state = GameState::default();
            state.language = language;
            state.time_scale = time_scale;
            state.screen = crate::model::GameScreen::Playing;
            state.log_line(state_text(
                state,
                "New run started. The paperwork is blank and already judgemental.",
                "Ny omgång startad. Pappersarbetet är tomt och redan dömande.",
            ));
            state.log_line(state_text(
                state,
                "Plan: build a calm loop before taking risky contracts.",
                "Plan: bygg en lugn produktionskedja innan du tar riskabla kontrakt.",
            ));
            return;
        }
        Action::ShowIntro => {
            state.screen = crate::model::GameScreen::Intro;
            return;
        }
        Action::ShowAnimalBook => {
            state.screen = crate::model::GameScreen::AnimalBook;
            return;
        }
        Action::BackToMenu => {
            state.screen = crate::model::GameScreen::MainMenu;
            state.settings_open = false;
            return;
        }
        Action::GoSanctuary
        | Action::GoCoffeeField
        | Action::GoRoastery
        | Action::GoPaperworkOffice => {
            switch_room(state, action);
            return;
        }
        Action::ShowCareTools
        | Action::ShowFieldTools
        | Action::ShowProductionTools
        | Action::ShowComplianceTools
        | Action::ShowUpgradeTools
        | Action::ShowSystemTools => {
            switch_tool_group(state, action);
            return;
        }
        _ => {}
    }

    if matches!(action, Action::ContinueDay) {
        state.day_report = None;
        if state.game_result.is_none() {
            state.log_line(if state.language == Language::Swedish {
                format!("Dag {} börjar. Böckerna ser vakna ut.", state.day)
            } else {
                format!("Day {} begins. The ledgers look awake.", state.day)
            });
        }
        return;
    }

    if matches!(action, Action::Save) {
        state.save();
        return;
    }

    if matches!(action, Action::Load) {
        if let Some(loaded) = GameState::load() {
            *state = loaded;
        } else {
            state.log_line(state_text(
                state,
                "No save file found.",
                "Ingen sparfil hittades.",
            ));
        }
        return;
    }

    if matches!(action, Action::CloseAnimalPanel) {
        state.selected_civet = None;
        state.dirty_visuals = true;
        state.log_line(state_text(
            state,
            "Animal care clipboard closed.",
            "Djurskötselblocket stängdes.",
        ));
        return;
    }

    if matches!(action, Action::ToggleInventory) {
        state.inventory_open = !state.inventory_open;
        state.log_line(if state.inventory_open {
            state_text(
                state,
                "Inventory sack opens into a bottom tray.",
                "Inventariesäcken öppnas till en bottenbricka.",
            )
        } else {
            state_text(
                state,
                "Inventory tray folds back into a coffee sack.",
                "Inventariebrickan viks tillbaka till en kaffesäck.",
            )
        });
        return;
    }

    if matches!(action, Action::CycleTimeScale) {
        state.time_scale = state.time_scale.next();
        state.log_line(if state.language == Language::Swedish {
            format!("Tidshastighet satt till {}.", state.time_scale.label())
        } else {
            format!("Time speed set to {}.", state.time_scale.label())
        });
        return;
    }

    match action {
        Action::ShowSettings => {
            state.settings_open = true;
            state.log_line(state_text(
                state,
                "Settings notebook opened.",
                "Inställningsboken öppnades.",
            ));
            return;
        }
        Action::CloseSettings => {
            state.settings_open = false;
            state.log_line(state_text(
                state,
                "Settings notebook closed.",
                "Inställningsboken stängdes.",
            ));
            return;
        }
        Action::ToggleLayoutGuides => {
            state.show_layout_guides = !state.show_layout_guides;
            state.dirty_visuals = true;
            state.log_line(if state.show_layout_guides {
                state_text(state, "Layout guides enabled.", "Layoutguider aktiverade.")
            } else {
                state_text(state, "Layout guides hidden.", "Layoutguider dolda.")
            });
            return;
        }
        Action::ToggleAudioMute => {
            state.audio_muted = !state.audio_muted;
            state.log_line(if state.audio_muted {
                state_text(state, "Audio muted.", "Ljud avstängt.")
            } else {
                state_text(state, "Audio enabled.", "Ljud påslaget.")
            });
            return;
        }
        Action::MusicVolumeDown => {
            state.music_volume = (state.music_volume - 0.12).clamp(0.0, 1.0);
            state.log_line(if state.language == Language::Swedish {
                format!("Musikvolym {:.0}%.", state.music_volume * 100.0)
            } else {
                format!("Music volume {:.0}%.", state.music_volume * 100.0)
            });
            return;
        }
        Action::MusicVolumeUp => {
            state.music_volume = (state.music_volume + 0.12).clamp(0.0, 1.0);
            state.log_line(if state.language == Language::Swedish {
                format!("Musikvolym {:.0}%.", state.music_volume * 100.0)
            } else {
                format!("Music volume {:.0}%.", state.music_volume * 100.0)
            });
            return;
        }
        Action::SfxVolumeDown => {
            state.sfx_volume = (state.sfx_volume - 0.12).clamp(0.0, 1.0);
            state.log_line(if state.language == Language::Swedish {
                format!("Effektvolym {:.0}%.", state.sfx_volume * 100.0)
            } else {
                format!("SFX volume {:.0}%.", state.sfx_volume * 100.0)
            });
            return;
        }
        Action::SfxVolumeUp => {
            state.sfx_volume = (state.sfx_volume + 0.12).clamp(0.0, 1.0);
            state.log_line(if state.language == Language::Swedish {
                format!("Effektvolym {:.0}%.", state.sfx_volume * 100.0)
            } else {
                format!("SFX volume {:.0}%.", state.sfx_volume * 100.0)
            });
            return;
        }
        Action::SetLanguageEnglish => {
            state.language = Language::English;
            state.settings_open = false;
            state.log_line("Language set to English.");
            return;
        }
        Action::SetLanguageSwedish => {
            state.language = Language::Swedish;
            state.settings_open = false;
            state.log_line("Språk satt till svenska.");
            return;
        }
        _ => {}
    }

    if matches!(
        action,
        Action::EventOptionA | Action::EventOptionB | Action::EventOptionC
    ) {
        resolve_event(state, action);
        return;
    }

    if matches!(action, Action::AcceptOrder | Action::DeclineOrder) {
        resolve_pending_order(state, action);
        return;
    }

    if state.day_report.is_some() || state.game_result.is_some() {
        state.log_line(state_text(
            state,
            "The day report is waiting for acknowledgement.",
            "Dagsrapporten väntar på kvittens.",
        ));
        return;
    }

    if state.inspection {
        match action {
            Action::InspectPaperwork => {
                let reduction = 46.0 + state.paperwork_level as f32 * 5.0;
                state.money -= 18;
                state.suspicion -= reduction;
                state.reputation += 3;
                state.inspection = false;
                state.log_line(state_text(
                    state,
                    "Authorities read the paperwork and become visibly tired.",
                    "Myndigheterna läser pappren och blir synbart trötta.",
                ));
            }
            Action::InspectTasting => {
                if state.roasted_coffee >= 4.0 {
                    state.roasted_coffee -= 4.0;
                    state.suspicion -= 34.0;
                    state.reputation += 6;
                    state.money -= 8;
                    state.log_line(state_text(
                        state,
                        "Coffee tasting successful. One inspector detects notes of panic.",
                        "Kaffeprovningen lyckas. En inspektör anar toner av panik.",
                    ));
                } else {
                    state.suspicion -= 12.0;
                    state.reputation -= 2;
                    state.log_line(state_text(
                        state,
                        "There was not enough roasted coffee. The tasting was mostly spoons.",
                        "Det fanns inte nog rostat kaffe. Provningen bestod mest av skedar.",
                    ));
                }
                state.inspection = false;
            }
            Action::InspectGoat => {
                state.suspicion -= 24.0;
                state.reputation -= 4;
                state.civet_happiness -= 6.0;
                state.goat_present = false;
                state.inspection = false;
                state.dirty_visuals = true;
                state.log_line(state_text(
                    state,
                    "The goat accepts no blame but leaves under legal advice.",
                    "Geten tar ingen skuld men lämnar platsen efter juridisk rådgivning.",
                ));
            }
            _ => state.log_line(state_text(
                state,
                "Normal work is paused during Operation Bitter Bean.",
                "Normalt arbete är pausat under Operation Bitter Bean.",
            )),
        }
        state.clamp();
        return;
    }

    match action {
        Action::PlantCoffee => {
            if state.money >= 14 {
                state.money -= 14;
                state.coffee_plants += 1;
                state.suspicion += if state.coffee_plants > 18 { 3.5 } else { 1.2 };
                state.log_line(state_text(
                    state,
                    "A coffee shrub is planted in a formation lawyers called unfortunate.",
                    "En kaffebuske planteras i en formation juristerna kallade olycklig.",
                ));
                state.dirty_visuals = true;
            } else {
                state.log_line(state_text(
                    state,
                    "Not enough money for another coffee plant.",
                    "Inte nog pengar för ännu en kaffeplanta.",
                ));
            }
        }
        Action::HarvestFruit => {
            let gained = state.coffee_plants as f32 * 1.6;
            state.coffee_fruit += gained;
            state.civet_happiness -= 0.8;
            state.dirty_visuals = true;
            state.log_line(if state.language == Language::Swedish {
                format!("Skördade {gained:.0} kaffefrukter.")
            } else {
                format!("Harvested {gained:.0} coffee fruit.")
            });
        }
        Action::FeedCivets => {
            let wanted = state.civets as f32 * 5.0;
            let fed = state.coffee_fruit.min(wanted);
            if fed > 0.0 {
                state.coffee_fruit -= fed;
                state.civet_feed += fed;
                let sorter_bonus = if state.fruit_sorter { 4.0 } else { 0.0 };
                state.civet_happiness += 8.0 + sorter_bonus + fed * 0.25;
                state.suspicion -= 1.0;
                state.dirty_visuals = true;
                state.cue_audio(AudioCue::CivetPurr);
                state.log_line(state_text(
                    state,
                    "Civets receive fruit. Morale improves. Optics remain complex.",
                    "Palmmårdarna får frukt. Moralen stiger. Optiken förblir komplex.",
                ));
            } else {
                state.civet_happiness -= 5.0;
                state.suspicion += 3.0;
                state.log_line(state_text(
                    state,
                    "No fruit to feed the civets. They file a silent complaint.",
                    "Ingen frukt att mata palmmårdarna med. De lämnar ett tyst klagomål.",
                ));
            }
        }
        Action::CollectBeans => {
            let found = 1.0 + state.civets as f32 * 0.35;
            state.processed_beans += found;
            state.suspicion += 0.7;
            state.dirty_visuals = true;
            state.cue_audio(AudioCue::CivetChirp);
            state.log_line(if state.language == Language::Swedish {
                format!("Samlade {found:.1} processade bönor från palmmårdsområdet.")
            } else {
                format!("Collected {found:.1} processed beans from the civet area.")
            });
        }
        Action::RoastCoffee => {
            let batch = state.processed_beans.min(8.0);
            if batch >= 1.0 {
                state.processed_beans -= batch;
                let yield_rate = if state.roasting_shed { 0.96 } else { 0.82 };
                state.roasted_coffee += batch * yield_rate;
                state.money -= if state.roasting_shed { 1 } else { 2 };
                state.suspicion += if state.roasting_shed { 0.4 } else { 0.8 };
                state.dirty_visuals = true;
                state.cue_audio(AudioCue::CoffeeRoast);
                state.log_line(state_text(
                    state,
                    "Roasted a premium batch. Smoke plume described as theatrical.",
                    "Rostade en premiumsats. Rökplymen beskrivs som teatralisk.",
                ));
            } else {
                state.log_line(state_text(
                    state,
                    "Not enough processed beans to roast.",
                    "Inte nog processade bönor att rosta.",
                ));
            }
        }
        Action::SellCoffee => {
            let sold = state.roasted_coffee.min(8.0);
            if sold >= 1.0 {
                let tasting_bonus = if state.tasting_room { 5.0 } else { 0.0 };
                let market_bonus = if current_modifier(state) == Some(DailyModifierKind::MarketRush)
                {
                    1.18
                } else {
                    1.0
                };
                let earned =
                    (sold * (13.0 + tasting_bonus + state.reputation as f32 * 0.7) * market_bonus)
                        .round() as i32;
                state.roasted_coffee -= sold;
                state.money += earned;
                state.daily_sales += earned;
                state.reputation += 1 + (sold / 5.0) as i32 + i32::from(state.tasting_room);
                let mut suspicion_gain = if sold > 6.0 {
                    if state.tasting_room { 2.5 } else { 4.0 }
                } else {
                    1.2
                };
                if current_modifier(state) == Some(DailyModifierKind::MarketRush) {
                    suspicion_gain *= 1.22;
                }
                state.suspicion += suspicion_gain;
                state.dirty_visuals = true;
                state.cue_audio(AudioCue::Cash);
                state.log_line(if state.language == Language::Swedish {
                    format!("Sålde {sold:.1} säckar palmmårdskaffe för ${earned}.")
                } else {
                    format!("Sold {sold:.1} bags of civet coffee for ${earned}.")
                });
            } else {
                state.log_line(state_text(
                    state,
                    "No roasted coffee ready to sell.",
                    "Inget rostat kaffe redo att säljas.",
                ));
            }
        }
        Action::DeliverOrder => deliver_order(state),
        Action::GiveFruitFromInventory => give_fruit_from_inventory(state),
        Action::PickUpBeansToInventory => pick_up_beans_to_inventory(state),
        Action::FeedSelectedCivet => feed_selected_civet(state),
        Action::PetSelectedCivet => pet_selected_civet(state),
        Action::InspectSelectedCivet => inspect_selected_civet(state),
        Action::UseTinyBrush => use_inventory_item(state, crate::model::InventoryItem::TinyBrush),
        Action::UseRibbonCollar => {
            use_inventory_item(state, crate::model::InventoryItem::RibbonCollar)
        }
        Action::UseFruitPuzzle => {
            use_inventory_item(state, crate::model::InventoryItem::FruitPuzzle)
        }
        Action::ImproveEnclosure => {
            let cost = 45 + state.enclosure_level as i32 * 20;
            if state.money >= cost {
                state.money -= cost;
                state.daily_expenses += cost;
                state.enclosure_level += 1;
                state.civet_happiness += 18.0;
                state.suspicion -= 8.0;
                state.reputation += 2;
                state.log_line(state_text(
                    state,
                    "Enclosure improved. Inspectors dislike how wholesome it is.",
                    "Hägnet förbättrades. Inspektörerna ogillar hur hälsosamt det ser ut.",
                ));
            } else {
                state.log_line(if state.language == Language::Swedish {
                    format!("Hägnuppgraderingen kräver ${cost}.")
                } else {
                    format!("Enclosure upgrade needs ${cost}.")
                });
            }
        }
        Action::ShowPaperwork => {
            let base_cost = if state.legal_office {
                8 + state.paperwork_level as i32 * 2
            } else {
                16 + state.paperwork_level as i32 * 3
            };
            let cost = if current_modifier(state) == Some(DailyModifierKind::BureaucracyDay) {
                (base_cost as f32 * 0.72).round() as i32
            } else {
                base_cost
            };
            if state.money >= cost {
                state.money -= cost;
                state.daily_expenses += cost;
                state.paperwork_level += 1;
                let legal_bonus = if state.legal_office { 8.0 } else { 0.0 };
                let modifier_bonus =
                    if current_modifier(state) == Some(DailyModifierKind::BureaucracyDay) {
                        6.0
                    } else {
                        0.0
                    };
                let reduction = 18.0 + legal_bonus + modifier_bonus + state.paperwork_level as f32;
                state.suspicion -= reduction;
                state.reputation += 1;
                state.dirty_visuals = true;
                state.cue_audio(AudioCue::PaperworkStamp);
                state.log_line(if state.language == Language::Swedish {
                    format!(
                        "Visade papperspaket nivå {} för ${cost}. Misstanke -{reduction:.0}%, rykte +1.",
                        state.paperwork_level
                    )
                } else {
                    format!(
                        "Presented paperwork level {} for ${cost}. Suspicion -{reduction:.0}%, reputation +1.",
                        state.paperwork_level
                    )
                });
            } else {
                state.log_line(state_text(
                    state,
                    "Not enough money to print the paperwork annex.",
                    "Inte nog pengar för att skriva ut pappersbilagan.",
                ));
            }
        }
        Action::BuildLegalOffice => buy_upgrade(
            state,
            110,
            |state| state.legal_office,
            |state| state.legal_office = true,
            "Built Legal Office. Suspicion now has to wait in reception.",
            "Byggde juridiskt kontor. Misstanken måste nu vänta i receptionen.",
        ),
        Action::HireCaretaker => buy_upgrade(
            state,
            85,
            |state| state.caretaker,
            |state| state.caretaker = true,
            "Hired caretaker. Civets receive professional attention and fewer dramatic sighs.",
            "Anställde djurskötare. Palmmårdarna får professionell omsorg och färre dramatiska suckar.",
        ),
        Action::BuildFruitSorter => buy_upgrade(
            state,
            95,
            |state| state.fruit_sorter,
            |state| state.fruit_sorter = true,
            "Installed fruit sorter. Low-quality fruit is now rejected before the civets can judge you.",
            "Installerade fruktsorterare. Dålig frukt avvisas nu innan palmmårdarna kan döma dig.",
        ),
        Action::BuildRoastingShed => buy_upgrade(
            state,
            125,
            |state| state.roasting_shed,
            |state| state.roasting_shed = true,
            "Built roasting shed. Smoke is now artisanal instead of incriminating.",
            "Byggde rostningsskjul. Röken är nu hantverksmässig i stället för belastande.",
        ),
        Action::BuildTastingRoom => buy_upgrade(
            state,
            140,
            |state| state.tasting_room,
            |state| state.tasting_room = true,
            "Opened tasting room. Guests pay extra to misunderstand the business in person.",
            "Öppnade provsmakningsrum. Gäster betalar extra för att missförstå verksamheten på plats.",
        ),
        Action::Save => state.save(),
        Action::Load => {
            if let Some(loaded) = GameState::load() {
                *state = loaded;
            } else {
                state.log_line(state_text(
                    state,
                    "No save file found.",
                    "Ingen sparfil hittades.",
                ));
            }
        }
        Action::InspectPaperwork | Action::InspectTasting | Action::InspectGoat => {}
        Action::EventOptionA | Action::EventOptionB | Action::EventOptionC => {}
        Action::AcceptOrder | Action::DeclineOrder => {}
        Action::CloseAnimalPanel => {}
        Action::ToggleInventory | Action::CycleTimeScale => {}
        Action::GoSanctuary
        | Action::GoCoffeeField
        | Action::GoRoastery
        | Action::GoPaperworkOffice => {}
        Action::ShowCareTools
        | Action::ShowFieldTools
        | Action::ShowProductionTools
        | Action::ShowComplianceTools
        | Action::ShowUpgradeTools
        | Action::ShowSystemTools => {}
        Action::ShowSettings
        | Action::CloseSettings
        | Action::ToggleLayoutGuides
        | Action::ToggleAudioMute
        | Action::MusicVolumeDown
        | Action::MusicVolumeUp
        | Action::SfxVolumeDown
        | Action::SfxVolumeUp
        | Action::SetLanguageEnglish
        | Action::SetLanguageSwedish => {}
        Action::StartGame
        | Action::StartNewRun
        | Action::ShowIntro
        | Action::ShowAnimalBook
        | Action::BackToMenu => {}
        Action::ContinueDay => {}
    }

    if state.civet_happiness < 35.0 {
        state.suspicion += 2.0;
        state.reputation -= 1;
    }
    state.clamp();
}

fn switch_room(state: &mut GameState, action: Action) {
    let room = match action {
        Action::GoSanctuary => PlantationRoom::Sanctuary,
        Action::GoCoffeeField => PlantationRoom::CoffeeField,
        Action::GoRoastery => PlantationRoom::Roastery,
        Action::GoPaperworkOffice => PlantationRoom::PaperworkOffice,
        _ => return,
    };

    state.current_room = room;
    state.player_x = -300.0;
    state.player_y = -145.0;
    state.active_tool_group = match room {
        PlantationRoom::Sanctuary => ToolGroup::Care,
        PlantationRoom::CoffeeField => ToolGroup::Field,
        PlantationRoom::Roastery => ToolGroup::Production,
        PlantationRoom::PaperworkOffice => ToolGroup::Compliance,
    };
    if room != PlantationRoom::Sanctuary {
        state.selected_civet = None;
    }
    state.dirty_visuals = true;
    let label = room_name_definite(room, state.language);
    state.log_line(if state.language == Language::Swedish {
        format!("Flyttade till {label}. Allt är fortfarande lagligt.")
    } else {
        format!("Moved to {label}. Everything is still legal.")
    });
    state.log_line(room_tip(state, room));
}

fn room_tip(state: &GameState, room: PlantationRoom) -> &'static str {
    if state.language == Language::Swedish {
        match room {
            PlantationRoom::Sanctuary => {
                "Rumstips: mata eller välj en palmmård för personlig omsorg."
            }
            PlantationRoom::CoffeeField => {
                "Rumstips: skörda frukt när plantorna är igång; plantera bara om ekonomin tål det."
            }
            PlantationRoom::Roastery => {
                "Rumstips: rosta processade bönor och sälj i lagom stora partier."
            }
            PlantationRoom::PaperworkOffice => {
                "Rumstips: hantera post först, stämpla papper när misstanken blir varm."
            }
        }
    } else {
        match room {
            PlantationRoom::Sanctuary => "Room tip: feed civets or select one for personal care.",
            PlantationRoom::CoffeeField => {
                "Room tip: harvest once plants are moving; plant only when cash can handle it."
            }
            PlantationRoom::Roastery => {
                "Room tip: roast processed beans and sell in measured batches."
            }
            PlantationRoom::PaperworkOffice => {
                "Room tip: handle mail first, stamp paperwork when suspicion heats up."
            }
        }
    }
}

fn switch_tool_group(state: &mut GameState, action: Action) {
    let group = match action {
        Action::ShowCareTools => ToolGroup::Care,
        Action::ShowFieldTools => ToolGroup::Field,
        Action::ShowProductionTools => ToolGroup::Production,
        Action::ShowComplianceTools => ToolGroup::Compliance,
        Action::ShowUpgradeTools => ToolGroup::Upgrades,
        Action::ShowSystemTools => ToolGroup::System,
        _ => return,
    };
    state.active_tool_group = group;
}

fn current_modifier(state: &GameState) -> Option<DailyModifierKind> {
    state.daily_modifier.as_ref().map(|modifier| modifier.kind)
}

pub fn select_civet_by_index(state: &mut GameState, index: usize) {
    state.ensure_civet_profiles();
    if index >= state.civet_profiles.len() {
        return;
    }

    state.selected_civet = Some(index);
    state.cue_audio(AudioCue::CivetChirp);
    let profile = &state.civet_profiles[index];
    state.log_line(if state.language == Language::Swedish {
        format!(
            "{} tassar fram. Humör {:.0}%, hunger {:.0}%.",
            profile.name, profile.mood, profile.hunger
        )
    } else {
        format!(
            "{} trots over. Mood {:.0}%, hunger {:.0}%.",
            profile.name, profile.mood, profile.hunger
        )
    });
}

fn selected_civet_index(state: &mut GameState) -> Option<usize> {
    state.ensure_civet_profiles();
    let index = state.selected_civet?;
    (index < state.civet_profiles.len()).then_some(index)
}

fn feed_selected_civet(state: &mut GameState) {
    let Some(index) = selected_civet_index(state) else {
        state.log_line(state_text(
            state,
            "Select a civet first.",
            "Välj en palmmård först.",
        ));
        return;
    };

    if state.coffee_fruit < 2.0 {
        state.civet_happiness -= 2.0;
        state.suspicion += 1.2;
        state.log_line(state_text(
            state,
            "Not enough coffee fruit for a personal snack tray.",
            "Inte nog kaffefrukt för en personlig snackbricka.",
        ));
        state.clamp();
        return;
    }

    state.coffee_fruit -= 2.0;
    state.civet_feed += 1.0;
    let status = civet_status_key(&state.civet_profiles[index]);
    let hungry_bonus = if status == "civet_status_hungry" {
        8.0
    } else {
        0.0
    };
    let profile = &mut state.civet_profiles[index];
    profile.hunger -= 28.0 + hungry_bonus;
    profile.mood += 8.0 + hungry_bonus * 0.25;
    let name = profile.name.clone();
    state.civet_happiness += 4.0 + hungry_bonus * 0.12;
    state.suspicion -= 0.8 + hungry_bonus * 0.03;
    state.dirty_visuals = true;
    state.cue_audio(AudioCue::CivetPurr);
    state.log_line(if state.language == Language::Swedish {
        if hungry_bonus > 0.0 {
            format!("{name} får en handplockad fruktbricka precis i tid och slappnar av märkbart.")
        } else {
            format!("{name} får en handplockad fruktbricka och godkänner den med gravallvarlig professionalism.")
        }
    } else {
        if hungry_bonus > 0.0 {
            format!("{name} gets a hand-picked fruit tray just in time and visibly settles.")
        } else {
            format!("{name} gets a hand-picked fruit tray and approves with grave professionalism.")
        }
    });
    state.clamp();
}

fn give_fruit_from_inventory(state: &mut GameState) {
    if state.current_room != PlantationRoom::Sanctuary {
        state.log_line(state_text(
            state,
            "Bring the coffee fruit to the Sanctuary first.",
            "Ta kaffefrukten till fristaden först.",
        ));
        return;
    }
    if state.coffee_fruit < 1.0 {
        state.log_line(state_text(
            state,
            "No coffee fruit in the inventory sack.",
            "Ingen kaffefrukt i inventariesäcken.",
        ));
        return;
    }
    if !state.near_civets() {
        state.log_line(state_text(
            state,
            "Walk closer to the civets before offering fruit.",
            "Gå närmare palmmårdarna innan du erbjuder frukt.",
        ));
        return;
    }

    state.ensure_civet_profiles();
    let index = state
        .selected_civet
        .unwrap_or(0)
        .min(state.civet_profiles.len().saturating_sub(1));
    state.selected_civet = Some(index);
    state.coffee_fruit -= 1.0;
    state.civet_feed += 1.0;

    let status = civet_status_key(&state.civet_profiles[index]);
    let hungry_bonus = if status == "civet_status_hungry" {
        5.0
    } else {
        0.0
    };
    let profile = &mut state.civet_profiles[index];
    profile.hunger -= 15.0 + hungry_bonus;
    profile.mood += 5.0 + hungry_bonus * 0.2;
    let name = profile.name.clone();
    state.civet_happiness += 2.0;
    state.suspicion -= 0.3;
    state.dirty_visuals = true;
    state.cue_audio(AudioCue::CivetChirp);
    state.log_line(if state.language == Language::Swedish {
        format!("{name} tar en kaffefrukt från inventariebrickan.")
    } else {
        format!("{name} takes a coffee fruit from your inventory tray.")
    });
    state.clamp();
}

fn pick_up_beans_to_inventory(state: &mut GameState) {
    if state.current_room != PlantationRoom::Sanctuary {
        state.log_line(state_text(
            state,
            "Processed beans are collected near the civets.",
            "Processade bönor samlas nära palmmårdarna.",
        ));
        return;
    }
    if !state.near_civets() {
        state.log_line(state_text(
            state,
            "Walk into the enclosure work area before picking up beans.",
            "Gå in i hägnets arbetsyta innan du plockar upp bönor.",
        ));
        return;
    }

    let found = 0.7 + state.civets as f32 * 0.22;
    state.processed_beans += found;
    state.suspicion += 0.4;
    state.dirty_visuals = true;
    state.cue_audio(AudioCue::CivetChirp);
    state.log_line(if state.language == Language::Swedish {
        format!("Plockade upp {found:.1} processade bönor och stoppade dem i inventariesäcken.")
    } else {
        format!("Picked up {found:.1} processed beans and tucked them into the inventory sack.")
    });
    state.clamp();
}

fn pet_selected_civet(state: &mut GameState) {
    let Some(index) = selected_civet_index(state) else {
        state.log_line(state_text(
            state,
            "Select a civet first.",
            "Välj en palmmård först.",
        ));
        return;
    };

    let profile = &mut state.civet_profiles[index];
    let status = civet_status_key(profile);
    let stress_bonus = if status == "civet_status_stressed" {
        6.0
    } else {
        0.0
    };
    profile.mood += 11.0 + stress_bonus;
    profile.hunger += 1.0;
    let name = profile.name.clone();
    state.civet_happiness += 2.5 + stress_bonus * 0.18;
    state.reputation += 1;
    state.suspicion -= 0.4 + stress_bonus * 0.05;
    state.dirty_visuals = true;
    state.cue_audio(AudioCue::CivetPurr);
    state.log_line(if state.language == Language::Swedish {
        format!("{name} får omsorg i fristadsklass. Det här är utmärkt PR, om någon frågar.")
    } else {
        format!(
            "{name} receives sanctuary-grade attention. This is excellent press, if anyone asks."
        )
    });
    state.clamp();
}

fn inspect_selected_civet(state: &mut GameState) {
    let Some(index) = selected_civet_index(state) else {
        state.log_line(state_text(
            state,
            "Select a civet first.",
            "Välj en palmmård först.",
        ));
        return;
    };

    let profile = &state.civet_profiles[index];
    state.log_line(if state.language == Language::Swedish {
        format!(
            "{}: {}, humör {:.0}%, hunger {:.0}%. Favoritfrukt: {}. Favoritomsorg: {}. {}",
            profile.name,
            civet_status_label(profile, state.language),
            profile.mood,
            profile.hunger,
            profile.favorite_fruit,
            care_item_name(profile.favorite_care_item, state.language),
            civet_need_text(profile, state.language)
        )
    } else {
        format!(
            "{}: {}, mood {:.0}%, hunger {:.0}%. Favorite fruit: {}. Favorite care: {}. {}",
            profile.name,
            civet_status_label(profile, state.language),
            profile.mood,
            profile.hunger,
            profile.favorite_fruit,
            care_item_name(profile.favorite_care_item, state.language),
            civet_need_text(profile, state.language)
        )
    });
}

fn use_inventory_item(state: &mut GameState, item: crate::model::InventoryItem) {
    let Some(index) = selected_civet_index(state) else {
        state.log_line(state_text(
            state,
            "Select a civet first.",
            "Välj en palmmård först.",
        ));
        return;
    };

    if !state.inventory.contains(&item) {
        state.log_line(state_text(
            state,
            "That item is not in the sanctuary basket.",
            "Det föremålet finns inte i fristadskorgen.",
        ));
        return;
    }

    let profile = &mut state.civet_profiles[index];
    let name = profile.name.clone();
    let favorite = profile.favorite_care_item == item;
    let item_name = care_item_name(item, state.language);
    let mood_bonus = if favorite { 4.0 } else { 0.0 };
    let happiness_bonus = if favorite { 1.0 } else { 0.0 };
    match item {
        crate::model::InventoryItem::TinyBrush => {
            profile.mood += 7.0 + mood_bonus;
            profile.hunger += 0.5;
            state.civet_happiness += 2.0 + happiness_bonus;
            state.reputation += 1;
            state.log_line(if state.language == Language::Swedish {
                if favorite {
                    format!("{name} får favoritverktyget {item_name}. Pälsläget blir investerarklart.")
                } else {
                    format!("{name} blir borstad. Pälsläget blir investerarklart.")
                }
            } else {
                if favorite {
                    format!("{name} gets favorite care item {item_name}. The fur situation becomes investor-ready.")
                } else {
                    format!("{name} gets brushed. The fur situation becomes investor-ready.")
                }
            });
        }
        crate::model::InventoryItem::RibbonCollar => {
            profile.mood += 5.0 + mood_bonus;
            state.civet_happiness += 1.5 + happiness_bonus;
            state.suspicion -= 0.7 + if favorite { 0.4 } else { 0.0 };
            state.log_line(if state.language == Language::Swedish {
                if favorite {
                    format!("{name} väljer glatt favoritverktyget {item_name} och ser extremt icke-kartell ut.")
                } else {
                    format!("{name} provar ett rosetthalsband och ser extremt icke-kartell ut.")
                }
            } else {
                if favorite {
                    format!("{name} happily picks favorite care item {item_name} and looks extremely non-cartel.")
                } else {
                    format!("{name} tries a ribbon collar and looks extremely non-cartel.")
                }
            });
        }
        crate::model::InventoryItem::FruitPuzzle => {
            profile.mood += 8.0 + mood_bonus;
            profile.hunger -= 4.0;
            state.civet_happiness += 2.5 + happiness_bonus;
            state.suspicion -= 0.4 + if favorite { 0.3 } else { 0.0 };
            state.log_line(if state.language == Language::Swedish {
                if favorite {
                    format!("{name} får favoritverktyget {item_name} och arbetar med små, seriösa tassar.")
                } else {
                    format!("{name} arbetar med ett fruktpussel med små, seriösa tassar.")
                }
            } else {
                if favorite {
                    format!("{name} gets favorite care item {item_name} and works with tiny, serious paws.")
                } else {
                    format!("{name} works on a fruit puzzle with tiny, serious paws.")
                }
            });
        }
    }

    state.dirty_visuals = true;
    state.cue_audio(AudioCue::CivetPurr);
    state.clamp();
}

fn resolve_pending_order(state: &mut GameState, action: Action) {
    let Some(order) = state.pending_order.take() else {
        state.log_line(state_text(
            state,
            "No premium order is waiting.",
            "Ingen premiumorder väntar.",
        ));
        return;
    };

    match action {
        Action::AcceptOrder => {
            state.cue_audio(AudioCue::OrderAccept);
            state.log_line(if state.language == Language::Swedish {
                format!(
                    "Accepterade order från {}: {:.1} säckar till dag {}.",
                    order.client, order.bags, order.due_day
                )
            } else {
                format!(
                    "Accepted order from {}: {:.1} bags due day {}.",
                    order.client, order.bags, order.due_day
                )
            });
            state.active_order = Some(order);
            state.suspicion += 1.5;
        }
        Action::DeclineOrder => {
            state.cue_audio(AudioCue::OrderDecline);
            state.log_line(if state.language == Language::Swedish {
                format!(
                    "Avböjde {}. Kontraktet använde för många lågmälda adjektiv.",
                    order.client
                )
            } else {
                format!(
                    "Declined {}. The contract used too many quiet adjectives.",
                    order.client
                )
            });
            state.reputation -= 1;
            state.suspicion -= 1.5;
        }
        _ => {}
    }
    state.clamp();
}

fn deliver_order(state: &mut GameState) {
    let Some(order) = state.active_order.clone() else {
        state.log_line(state_text(
            state,
            "No active premium order to deliver.",
            "Ingen aktiv premiumorder att leverera.",
        ));
        return;
    };

    if state.roasted_coffee < order.bags {
        state.log_line(if state.language == Language::Swedish {
            format!(
                "Ordern kräver {:.1} rostade säckar. Nuvarande lager är {:.1}.",
                order.bags, state.roasted_coffee
            )
        } else {
            format!(
                "Order needs {:.1} roasted bags. Current stock is {:.1}.",
                order.bags, state.roasted_coffee
            )
        });
        return;
    }

    state.roasted_coffee -= order.bags;
    state.money += order.payout;
    state.daily_sales += order.payout;
    state.reputation += order.reputation_reward + i32::from(state.tasting_room);
    let legal_reduction = if state.legal_office { 1.5 } else { 0.0 };
    state.suspicion += (order.suspicion_risk - legal_reduction).max(0.5);
    state.active_order = None;
    state.cue_audio(AudioCue::Cash);
    state.log_line(if state.language == Language::Swedish {
        format!(
            "Levererade premiumorder till {} för ${}.",
            order.client, order.payout
        )
    } else {
        format!(
            "Delivered premium order to {} for ${}.",
            order.client, order.payout
        )
    });
    state.clamp();
}

fn buy_upgrade(
    state: &mut GameState,
    cost: i32,
    already_bought: impl Fn(&GameState) -> bool,
    apply: impl Fn(&mut GameState),
    message_en: &'static str,
    message_sv: &'static str,
) {
    if already_bought(state) {
        state.log_line(state_text(
            state,
            "That upgrade is already in place.",
            "Den uppgraderingen är redan på plats.",
        ));
        return;
    }
    if state.money < cost {
        state.log_line(if state.language == Language::Swedish {
            format!("Uppgraderingen kräver ${cost}.")
        } else {
            format!("Upgrade needs ${cost}.")
        });
        return;
    }

    state.money -= cost;
    state.daily_expenses += cost;
    state.suspicion += 2.0;
    state.reputation += 1;
    apply(state);
    state.dirty_visuals = true;
    state.log_line(state_text(state, message_en, message_sv));
}

fn resolve_event(state: &mut GameState, action: Action) {
    let Some(event) = state.event.take() else {
        state.log_line(state_text(
            state,
            "No event is waiting for a decision.",
            "Ingen händelse väntar på beslut.",
        ));
        return;
    };

    state.cue_audio(AudioCue::EventNotice);
    match event.kind {
        RandomEventKind::PoliceVisit
        | RandomEventKind::JournalistQuestions
        | RandomEventKind::PaperworkAudit => state.cue_audio(AudioCue::PaperworkStamp),
        RandomEventKind::WelfareInspection
        | RandomEventKind::VeterinarianOffer
        | RandomEventKind::PickyCivet => state.cue_audio(AudioCue::CivetChirp),
        RandomEventKind::HelicopterOverhead => state.cue_audio(AudioCue::Suspicion),
        RandomEventKind::BinturongEscape => state.cue_audio(AudioCue::CivetPurr),
        RandomEventKind::GoatAppearance => state.cue_audio(AudioCue::GoatBleat),
        RandomEventKind::TouristGroup => state.cue_audio(AudioCue::Cash),
        RandomEventKind::Rainstorm => state.cue_audio(AudioCue::Rain),
        RandomEventKind::InfluencerVisit => state.cue_audio(AudioCue::Camera),
    }

    match (event.kind, action) {
        (RandomEventKind::PoliceVisit, Action::EventOptionA) => {
            state.money -= 14;
            state.suspicion -= 13.0 + state.paperwork_level as f32 * 1.5;
            state.reputation += 1;
            state.log_line(state_text(
                state,
                "Police accept the paperwork and leave with a laminated bean diagram.",
                "Polisen godtar pappren och går med ett laminerat böndiagram.",
            ));
        }
        (RandomEventKind::PoliceVisit, Action::EventOptionB) => {
            state.roasted_coffee = (state.roasted_coffee - 2.0).max(0.0);
            state.suspicion -= 8.0;
            state.reputation += 2;
            state.log_line(state_text(
                state,
                "Officers attend a tasting and downgrade the threat to 'nutty finish'.",
                "Poliserna deltar i en provning och nedgraderar hotet till 'nötig eftersmak'.",
            ));
        }
        (RandomEventKind::PoliceVisit, Action::EventOptionC) => {
            state.suspicion += 9.0;
            state.reputation -= 2;
            state.log_line(state_text(
                state,
                "You answer evasively. The officers write 'too much coffee confidence'.",
                "Du svarar undvikande. Poliserna skriver 'för mycket kaffesjälvförtroende'.",
            ));
        }

        (RandomEventKind::JournalistQuestions, Action::EventOptionA) => {
            state.reputation += 4;
            state.suspicion += 4.0;
            state.log_line(state_text(
                state,
                "The journalist loves the civets. The headline still uses 'mysterious'.",
                "Journalisten älskar palmmårdarna. Rubriken använder ändå 'mystiskt'.",
            ));
        }
        (RandomEventKind::JournalistQuestions, Action::EventOptionB) => {
            state.money -= 20;
            state.suspicion -= 9.0;
            state.reputation += 1;
            state.log_line(state_text(
                state,
                "You give a controlled tour. Every label says 'coffee' twice.",
                "Du ger en kontrollerad rundtur. Varje etikett säger 'kaffe' två gånger.",
            ));
        }
        (RandomEventKind::JournalistQuestions, Action::EventOptionC) => {
            state.suspicion += 12.0;
            state.reputation -= 3;
            state.log_line(state_text(
                state,
                "No comment becomes the story. The goat is photographed in profile.",
                "Ingen kommentar blir själva nyheten. Geten fotograferas i profil.",
            ));
        }

        (RandomEventKind::WelfareInspection, Action::EventOptionA) => {
            state.money -= 24;
            state.civet_happiness += 12.0;
            state.reputation += 3;
            state.suspicion -= 5.0;
            state.log_line(state_text(
                state,
                "Emergency enrichment deployed. Civets receive excellent tiny furniture.",
                "Akut berikning sätts in. Palmmårdarna får utmärkta små möbler.",
            ));
        }
        (RandomEventKind::WelfareInspection, Action::EventOptionB) => {
            if state.civet_happiness >= 60.0 {
                state.reputation += 4;
                state.suspicion -= 7.0;
                state.log_line(state_text(
                    state,
                    "Inspection passes. Civets look professionally satisfied.",
                    "Inspektionen godkänns. Palmmårdarna ser professionellt nöjda ut.",
                ));
            } else {
                state.reputation -= 4;
                state.suspicion += 10.0;
                state.log_line(state_text(
                    state,
                    "Inspection finds disappointed civets and suspiciously tidy excuses.",
                    "Inspektionen hittar besvikna palmmårdar och misstänkt prydliga ursäkter.",
                ));
            }
        }
        (RandomEventKind::WelfareInspection, Action::EventOptionC) => {
            state.money -= 10;
            state.reputation -= 1;
            state.suspicion += 2.0;
            state.log_line(state_text(
                state,
                "You reschedule. It works, but the clipboard remembers.",
                "Du bokar om. Det fungerar, men skrivplattan minns.",
            ));
        }

        (RandomEventKind::HelicopterOverhead, Action::EventOptionA) => {
            state.suspicion -= 7.0;
            state.money -= 12;
            state.log_line(state_text(
                state,
                "Reflective coffee tarps deployed. Perfectly normal agricultural behavior.",
                "Reflekterande kaffepresenningar läggs ut. Fullt normalt jordbruksbeteende.",
            ));
        }
        (RandomEventKind::HelicopterOverhead, Action::EventOptionB) => {
            state.reputation += 2;
            state.suspicion += 5.0;
            state.log_line(state_text(
                state,
                "You wave cheerfully. This is either innocence or advanced theater.",
                "Du vinkar glatt. Det är antingen oskuld eller avancerad teater.",
            ));
        }
        (RandomEventKind::HelicopterOverhead, Action::EventOptionC) => {
            state.suspicion += 13.0;
            state.log_line(state_text(
                state,
                "Everyone hides. The helicopter learns nothing and suspects everything.",
                "Alla gömmer sig. Helikoptern lär sig inget och misstänker allt.",
            ));
        }

        (RandomEventKind::BinturongEscape, Action::EventOptionA) => {
            state.money -= 16;
            state.binturong_home = true;
            state.civet_happiness += 3.0;
            state.suspicion -= 4.0;
            state.log_line(state_text(
                state,
                "A caretaker retrieves the binturong with snacks and quiet bargaining.",
                "En djurskötare hämtar binturongen med snacks och lågmäld förhandling.",
            ));
        }
        (RandomEventKind::BinturongEscape, Action::EventOptionB) => {
            state.binturong_home = false;
            state.reputation += 1;
            state.suspicion += 7.0;
            state.log_line(state_text(
                state,
                "The binturong becomes a local celebrity and a regulatory problem.",
                "Binturongen blir lokal kändis och ett regelverksproblem.",
            ));
        }
        (RandomEventKind::BinturongEscape, Action::EventOptionC) => {
            state.goat_present = true;
            state.binturong_home = true;
            state.reputation -= 1;
            state.suspicion += 3.0;
            state.log_line(state_text(
                state,
                "The goat is sent as negotiator. Nobody understands why it works.",
                "Geten skickas som förhandlare. Ingen förstår varför det fungerar.",
            ));
        }

        (RandomEventKind::PickyCivet, Action::EventOptionA) => {
            let spent = state.coffee_fruit.min(8.0);
            state.coffee_fruit -= spent;
            state.civet_happiness += 10.0;
            state.reputation += 1;
            state.log_line(state_text(
                state,
                "Only the best fruit is served. The civet accepts tribute.",
                "Bara den bästa frukten serveras. Palmmården accepterar tributet.",
            ));
        }
        (RandomEventKind::PickyCivet, Action::EventOptionB) => {
            state.money -= 18;
            state.civet_happiness += 8.0;
            state.suspicion -= 2.0;
            state.log_line(state_text(
                state,
                "Imported fruit arrives with more documentation than the staff.",
                "Importerad frukt anländer med mer dokumentation än personalen.",
            ));
        }
        (RandomEventKind::PickyCivet, Action::EventOptionC) => {
            state.civet_happiness -= 9.0;
            state.suspicion += 4.0;
            state.reputation -= 1;
            state.log_line(state_text(
                state,
                "You insist the fruit is fine. The civet disagrees in silence.",
                "Du insisterar på att frukten duger. Palmmården håller tyst medvetet.",
            ));
        }

        (RandomEventKind::GoatAppearance, Action::EventOptionA) => {
            state.goat_present = true;
            state.suspicion += 2.0;
            state.reputation += 1;
            state.log_line(state_text(
                state,
                "The goat is listed as unpaid compliance intern.",
                "Geten listas som obetald compliance-praktikant.",
            ));
        }
        (RandomEventKind::GoatAppearance, Action::EventOptionB) => {
            state.goat_present = false;
            state.money -= 9;
            state.suspicion -= 4.0;
            state.log_line(state_text(
                state,
                "The goat is escorted off-site by a very serious courier.",
                "Geten eskorteras bort av ett mycket allvarligt bud.",
            ));
        }
        (RandomEventKind::GoatAppearance, Action::EventOptionC) => {
            state.goat_present = true;
            state.suspicion -= 2.0;
            state.civet_happiness += 2.0;
            state.log_line(state_text(
                state,
                "You blame the goat preemptively. Oddly, morale improves.",
                "Du skyller förebyggande på geten. Märkligt nog förbättras moralen.",
            ));
        }

        (RandomEventKind::TouristGroup, Action::EventOptionA) => {
            state.money += 34;
            state.daily_sales += 34;
            state.reputation += 3;
            state.suspicion += 5.5;
            state.log_line(state_text(
                state,
                "The full tour sells coffee and creates too many searchable photos.",
                "Hela rundturen säljer kaffe och skapar för många sökbara foton.",
            ));
        }
        (RandomEventKind::TouristGroup, Action::EventOptionB) => {
            state.money += 18;
            state.daily_sales += 18;
            state.reputation += 2;
            state.suspicion -= 1.5;
            state.log_line(state_text(
                state,
                "A careful route shows the roastery, not the awkward angles.",
                "En försiktig rutt visar rosteriet, inte de besvärliga vinklarna.",
            ));
        }
        (RandomEventKind::TouristGroup, Action::EventOptionC) => {
            state.reputation -= 2;
            state.suspicion -= 3.0;
            state.log_line(state_text(
                state,
                "The gates close. Tourists grumble, but nobody photographs the paperwork.",
                "Grindarna stängs. Turister muttrar, men ingen fotograferar pappren.",
            ));
        }

        (RandomEventKind::VeterinarianOffer, Action::EventOptionA) => {
            state.money -= 28;
            state.civet_happiness += 15.0;
            state.reputation += 2;
            state.suspicion -= 4.0;
            state.log_line(state_text(
                state,
                "The vet signs every civet as healthy, opinionated, and well documented.",
                "Veterinären intygar att varje palmmård är frisk, åsiktsstark och väl dokumenterad.",
            ));
        }
        (RandomEventKind::VeterinarianOffer, Action::EventOptionB) => {
            let coffee = state.roasted_coffee.min(3.0);
            state.roasted_coffee -= coffee;
            state.civet_happiness += 9.0 + coffee;
            state.suspicion -= 2.5;
            state.log_line(state_text(
                state,
                "The vet accepts coffee barter and leaves with excellent notes.",
                "Veterinären godtar kaffe som byte och lämnar utmärkta anteckningar.",
            ));
        }
        (RandomEventKind::VeterinarianOffer, Action::EventOptionC) => {
            state.civet_happiness -= 5.0;
            state.reputation -= 1;
            state.suspicion += 3.0;
            state.log_line(state_text(
                state,
                "You decline. The civets take this personally in a medically vague way.",
                "Du avböjer. Palmmårdarna tar det personligt på ett medicinskt vagt sätt.",
            ));
        }

        (RandomEventKind::Rainstorm, Action::EventOptionA) => {
            state.coffee_fruit += state.coffee_plants as f32 * 1.4;
            state.suspicion += 2.0;
            state.log_line(state_text(
                state,
                "Workers harvest through rain. The fruit wins and the boots lose.",
                "Personalen skördar i regnet. Frukten vinner och stövlarna förlorar.",
            ));
        }
        (RandomEventKind::Rainstorm, Action::EventOptionB) => {
            state.civet_happiness += 11.0;
            state.suspicion -= 3.0;
            state.log_line(state_text(
                state,
                "Everyone shelters the animals. Production waits, morale does not.",
                "Alla skyddar djuren. Produktionen väntar, moralen gör det inte.",
            ));
        }
        (RandomEventKind::Rainstorm, Action::EventOptionC) => {
            state.money -= 8;
            state.paperwork_level += 1;
            state.suspicion -= 5.0;
            state.log_line(state_text(
                state,
                "The office becomes a dry archive of very persuasive stamps.",
                "Kontoret blir ett torrt arkiv av mycket övertygande stämplar.",
            ));
        }

        (RandomEventKind::InfluencerVisit, Action::EventOptionA) => {
            state.reputation += 5;
            state.suspicion += 8.0;
            state.civet_happiness -= 2.0;
            state.log_line(state_text(
                state,
                "The video goes viral. So does the comment asking about permits.",
                "Videon blir viral. Det blir också kommentaren som frågar om tillstånd.",
            ));
        }
        (RandomEventKind::InfluencerVisit, Action::EventOptionB) => {
            state.money += 22;
            state.daily_sales += 22;
            state.reputation += 2;
            state.suspicion += 1.0;
            state.log_line(state_text(
                state,
                "The camera sees cups, labels, and nothing with a tail.",
                "Kameran ser koppar, etiketter och inget med svans.",
            ));
        }
        (RandomEventKind::InfluencerVisit, Action::EventOptionC) => {
            state.reputation -= 2;
            state.suspicion -= 4.0;
            state.log_line(state_text(
                state,
                "No phones pass the gate. The post becomes boring and legally helpful.",
                "Inga mobiler passerar grinden. Inlägget blir tråkigt och juridiskt hjälpsamt.",
            ));
        }

        (RandomEventKind::PaperworkAudit, Action::EventOptionA) => {
            state.money -= 26;
            state.paperwork_level += 1;
            state.suspicion -= 9.0;
            state.reputation += 1;
            state.log_line(state_text(
                state,
                "Legal prep turns the audit into a footnote with coffee stains.",
                "Juridisk förberedelse gör revisionen till en fotnot med kaffefläckar.",
            ));
        }
        (RandomEventKind::PaperworkAudit, Action::EventOptionB) => {
            state.money -= 10;
            state.paperwork_level += 2;
            state.suspicion -= 5.0;
            state.log_line(state_text(
                state,
                "Annexes flood the room. The auditor accepts defeat by pagination.",
                "Bilagor fyller rummet. Revisorn accepterar nederlag via sidnumrering.",
            ));
        }
        (RandomEventKind::PaperworkAudit, Action::EventOptionC) => {
            state.suspicion += 8.0;
            state.reputation -= 2;
            state.log_line(state_text(
                state,
                "You improvise. The auditor underlines silence twice.",
                "Du improviserar. Revisorn stryker under tystnaden två gånger.",
            ));
        }
        _ => {}
    }

    state.dirty_visuals = true;
    state.clamp();
}
