use bevy::prelude::*;

use crate::localization::{civet_status_key, state_text};
use crate::model::{
    AudioCue, DailyModifier, DailyModifierKind, DayReport, DayTick, EventState, EventTick,
    GameResult, GameScreen, GameState, GameTick, Language, OrderOffer, OrderStyle, OrderTick,
    RandomEventKind,
};

pub fn tick_game(time: Res<Time>, mut timer: ResMut<GameTick>, mut state: ResMut<GameState>) {
    let delta = time.delta().mul_f32(state.time_scale.multiplier());
    if !timer.0.tick(delta).just_finished()
        || state.screen != GameScreen::Playing
        || state.inspection
        || state.day_report.is_some()
        || state.game_result.is_some()
    {
        return;
    }

    if state.daily_modifier.is_none() {
        assign_daily_modifier(&mut state);
    }

    let harvest_multiplier = match current_modifier(&state) {
        Some(DailyModifierKind::RainyHarvest) => 1.28,
        _ => 1.0,
    };
    let fruit_growth = state.coffee_plants as f32 * 0.42 * harvest_multiplier;
    state.coffee_fruit += fruit_growth * if state.fruit_sorter { 1.08 } else { 1.0 };

    let appetite = state.civets as f32 * 0.65;
    let eaten = state.civet_feed.min(appetite);
    if eaten > 0.0 {
        state.civet_feed -= eaten;
        let happiness_bonus = (state.civet_happiness / 100.0).max(0.2);
        let enclosure_bonus = 1.0 + state.enclosure_level as f32 * 0.08;
        let caretaker_bonus = if state.caretaker { 1.12 } else { 1.0 };
        let strain_penalty = civet_production_penalty(&state);
        state.processed_beans +=
            eaten * 0.32 * happiness_bonus * enclosure_bonus * caretaker_bonus * strain_penalty;
        state.civet_happiness += if state.caretaker { 0.55 } else { 0.25 };
    } else {
        state.civet_happiness -= if state.caretaker { 0.6 } else { 1.4 };
        if state.civet_happiness < 45.0 {
            state.suspicion += 0.7;
        }
    }

    update_animal_care(&mut state, eaten);

    if state.coffee_plants > 24 {
        state.suspicion += 0.25;
    }
    if state.reputation < 0 {
        state.suspicion += 0.2;
    }
    state.clamp();
}

fn civet_production_penalty(state: &GameState) -> f32 {
    if state.civet_profiles.is_empty() {
        return 1.0;
    }
    let strained = state
        .civet_profiles
        .iter()
        .filter(|profile| {
            matches!(
                civet_status_key(profile),
                "civet_status_hungry" | "civet_status_stressed"
            )
        })
        .count() as f32;
    (1.0 - strained * 0.08).clamp(0.65, 1.0)
}

fn update_animal_care(state: &mut GameState, eaten: f32) {
    state.ensure_civet_profiles();
    if state.civet_profiles.is_empty() {
        return;
    }

    let per_civet_food = if state.civets > 0 {
        eaten / state.civets as f32
    } else {
        0.0
    };
    let hunger_drift = if state.caretaker { 1.0 } else { 1.45 };
    let mood_support =
        state.enclosure_level as f32 * 0.18 + if state.caretaker { 0.55 } else { 0.0 };

    let mut hunger_total = 0.0;
    let mut mood_total = 0.0;
    let mut stressed_count = 0;
    let mut hungry_count = 0;
    for profile in &mut state.civet_profiles {
        profile.hunger += hunger_drift - per_civet_food * 7.5;
        if profile.hunger > 72.0 {
            profile.mood -= 1.0;
        } else if profile.hunger < 38.0 {
            profile.mood += 0.35;
        }
        profile.mood += mood_support;
        profile.hunger = profile.hunger.clamp(0.0, 100.0);
        profile.mood = profile.mood.clamp(0.0, 100.0);
        match civet_status_key(profile) {
            "civet_status_hungry" => hungry_count += 1,
            "civet_status_stressed" => stressed_count += 1,
            _ => {}
        }
        hunger_total += profile.hunger;
        mood_total += profile.mood;
    }

    let count = state.civet_profiles.len() as f32;
    let average_hunger = hunger_total / count;
    let average_mood = mood_total / count;
    let care_score = (average_mood * 0.72 + (100.0 - average_hunger) * 0.28).clamp(0.0, 100.0);
    state.civet_happiness = (state.civet_happiness * 0.84 + care_score * 0.16).clamp(0.0, 100.0);
    if stressed_count > 0 {
        state.suspicion += stressed_count as f32 * 0.18;
        state.reputation -= i32::from(stressed_count >= 2);
    }
    if hungry_count > 0 {
        state.suspicion += hungry_count as f32 * 0.12;
    }
    if average_hunger > 82.0 {
        state.suspicion += 0.45;
        state.reputation -= 1;
    }
}

fn current_modifier(state: &GameState) -> Option<DailyModifierKind> {
    state.daily_modifier.as_ref().map(|modifier| modifier.kind)
}

fn assign_daily_modifier(state: &mut GameState) {
    let kind = match state.rand_index(4) {
        0 => DailyModifierKind::RainyHarvest,
        1 => DailyModifierKind::QuietNewsDay,
        2 => DailyModifierKind::BureaucracyDay,
        _ => DailyModifierKind::MarketRush,
    };
    state.daily_modifier = Some(DailyModifier {
        kind,
        title: modifier_title(kind, state.language).to_string(),
        body: modifier_body(kind, state.language).to_string(),
    });
    state.dirty_visuals = true;
    let title = state
        .daily_modifier
        .as_ref()
        .map(|modifier| modifier.title.clone());
    if let Some(title) = title {
        state.log_line(if state.language == Language::Swedish {
            format!("Dagens läge: {title}.")
        } else {
            format!("Daily modifier: {title}.")
        });
    }
}

fn modifier_title(kind: DailyModifierKind, language: Language) -> &'static str {
    if language == Language::Swedish {
        match kind {
            DailyModifierKind::RainyHarvest => "Regnig skördedag",
            DailyModifierKind::QuietNewsDay => "Lugn nyhetsdag",
            DailyModifierKind::BureaucracyDay => "Byråkratisk medvind",
            DailyModifierKind::MarketRush => "Marknadsrusning",
        }
    } else {
        match kind {
            DailyModifierKind::RainyHarvest => "Rainy Harvest",
            DailyModifierKind::QuietNewsDay => "Quiet News Day",
            DailyModifierKind::BureaucracyDay => "Bureaucratic Tailwind",
            DailyModifierKind::MarketRush => "Market Rush",
        }
    }
}

fn modifier_body(kind: DailyModifierKind, language: Language) -> &'static str {
    if language == Language::Swedish {
        match kind {
            DailyModifierKind::RainyHarvest => "Kaffefrukten växer snabbare i regnet.",
            DailyModifierKind::QuietNewsDay => {
                "Misstanke svalnar snabbare när ingen jagar rubriker."
            }
            DailyModifierKind::BureaucracyDay => "Pappersarbete biter bättre och kostar mindre.",
            DailyModifierKind::MarketRush => {
                "Kunder betalar mer, men stora försäljningar märks tydligare."
            }
        }
    } else {
        match kind {
            DailyModifierKind::RainyHarvest => "Coffee fruit grows faster in the rain.",
            DailyModifierKind::QuietNewsDay => {
                "Suspicion cools faster while no one chases headlines."
            }
            DailyModifierKind::BureaucracyDay => "Paperwork works harder and costs less.",
            DailyModifierKind::MarketRush => {
                "Buyers pay more, but big sales draw sharper attention."
            }
        }
    }
}

pub fn advance_day(time: Res<Time>, mut timer: ResMut<DayTick>, mut state: ResMut<GameState>) {
    if state.screen != GameScreen::Playing
        || state.inspection
        || state.day_report.is_some()
        || state.game_result.is_some()
    {
        return;
    }

    let delta = time.delta().mul_f32(state.time_scale.multiplier());
    let finished = timer.0.tick(delta).just_finished();
    let duration = timer.0.duration().as_secs_f32().max(1.0);
    state.day_progress = (timer.0.elapsed().as_secs_f32() / duration).clamp(0.0, 1.0);

    if !finished {
        return;
    }

    let report = settle_day(&mut state);
    state.cue_audio(AudioCue::DayReport);
    state.day_report = Some(report);
    state.day_progress = 0.0;
}

pub fn generate_order_offers(
    time: Res<Time>,
    mut timer: ResMut<OrderTick>,
    mut state: ResMut<GameState>,
) {
    let delta = time.delta().mul_f32(state.time_scale.multiplier());
    if !timer.0.tick(delta).just_finished()
        || state.screen != GameScreen::Playing
        || state.inspection
        || state.pending_order.is_some()
        || state.day_report.is_some()
        || state.game_result.is_some()
        || state.pending_order.is_some()
        || state.active_order.is_some()
    {
        return;
    }

    let client = match state.rand_index(5) {
        0 => "Nordic Embassy Breakfast Desk",
        1 => "Suspiciously Calm Boutique Hotel",
        2 => "Ministry of Agricultural Irony",
        3 => "Very Normal Import Cooperative",
        _ => "Monaco Goat-Free Espresso Bar",
    };
    let style = match state.rand_index(4) {
        0 => OrderStyle::Rush,
        1 => OrderStyle::Discreet,
        2 => OrderStyle::Reputation,
        _ => OrderStyle::Steady,
    };
    let mut bags = 3.0 + state.rand_index(5) as f32;
    let base_price = 22.0 + state.reputation.max(0) as f32 * 0.9;
    let tasting_bonus = if state.tasting_room { 1.15 } else { 1.0 };
    let mut payout_multiplier = tasting_bonus;
    let mut reputation_reward = 2 + (bags / 4.0) as i32;
    let mut suspicion_risk = 2.5 + bags * 0.55;
    let mut due_day = (state.day + 3).min(7);

    match style {
        OrderStyle::Rush => {
            bags += 0.5;
            payout_multiplier *= 1.24;
            reputation_reward += 1;
            suspicion_risk += 1.6;
            due_day = (state.day + 2).min(7);
        }
        OrderStyle::Discreet => {
            payout_multiplier *= 1.12;
            suspicion_risk += 3.6;
        }
        OrderStyle::Reputation => {
            payout_multiplier *= 0.88;
            reputation_reward += 4;
            suspicion_risk = (suspicion_risk - 1.2).max(0.8);
        }
        OrderStyle::Steady => {}
    }
    let payout = (bags * base_price * payout_multiplier).round() as i32;

    state.pending_order = Some(OrderOffer {
        client: client.to_string(),
        style,
        bags,
        payout,
        reputation_reward,
        suspicion_risk,
        due_day,
    });
    state.cue_audio(AudioCue::EventNotice);
    let order_message = if state.language == Language::Swedish {
        format!(
            "Nytt kontrakt i papperskontoret: {:.1} säckar till dag {due_day}, ${payout}.",
            bags
        )
    } else {
        format!("New office contract: {bags:.1} bags by day {due_day}, ${payout}.")
    };
    state.log_line(order_message);
}

fn settle_day(state: &mut GameState) -> DayReport {
    let day = state.day;
    let upkeep = 18
        + state.civets as i32 * 5
        + state.enclosure_level as i32 * 7
        + state.paperwork_level as i32 * 3
        + (state.coffee_plants as i32 / 3)
        + if state.legal_office { 12 } else { 0 }
        + if state.caretaker { 14 } else { 0 }
        + if state.fruit_sorter { 8 } else { 0 }
        + if state.roasting_shed { 10 } else { 0 }
        + if state.tasting_room { 12 } else { 0 };
    state.money -= upkeep;
    state.daily_expenses += upkeep;

    let mut reputation_delta = 0;
    let mut suspicion_delta = 0.0;

    if state.daily_sales >= 120 {
        reputation_delta += 2;
        suspicion_delta += 3.5;
    } else if state.daily_sales <= 0 {
        reputation_delta -= 1;
        suspicion_delta += 1.0;
    }

    if state.civet_happiness >= 75.0 {
        reputation_delta += 2;
        suspicion_delta -= 3.0;
    } else if state.civet_happiness < 35.0 {
        reputation_delta -= 3;
        suspicion_delta += 8.0;
    }

    if state.suspicion >= 80.0 {
        reputation_delta -= 1;
    }
    if state.paperwork_level >= state.day {
        suspicion_delta -= 2.5;
    }
    if matches!(
        current_modifier(state),
        Some(DailyModifierKind::QuietNewsDay | DailyModifierKind::BureaucracyDay)
    ) {
        suspicion_delta -= if matches!(
            current_modifier(state),
            Some(DailyModifierKind::QuietNewsDay)
        ) {
            1.8
        } else {
            state.paperwork_level as f32 * 0.45
        };
    }
    if state.legal_office {
        suspicion_delta -= 2.0;
    }
    if state.tasting_room && state.daily_sales > 0 {
        reputation_delta += 1;
    }

    if state
        .active_order
        .as_ref()
        .is_some_and(|order| order.due_day <= day)
    {
        state.active_order = None;
        reputation_delta -= 3;
        suspicion_delta += 6.0;
        state.log_line(state_text(
            state,
            "Missed a premium order. The buyer files a complaint with adjectives.",
            "Missade en premiumorder. Köparen lämnar ett klagomål med adjektiv.",
        ));
    }

    if state
        .pending_order
        .as_ref()
        .is_some_and(|order| order.due_day <= day)
    {
        state.pending_order = None;
        reputation_delta -= 1;
        suspicion_delta += 2.0;
        state.log_line(state_text(
            state,
            "An unopened contract expires in the mailbox. Mildly bad optics.",
            "Ett oöppnat kontrakt löper ut i postlådan. Milt dålig optik.",
        ));
    }

    if state
        .event
        .as_ref()
        .is_some_and(|event| event.due_day <= day)
    {
        let title = state
            .event
            .as_ref()
            .map(|event| event.title.clone())
            .unwrap_or_else(|| {
                state_text(state, "Mailbox incident", "Postlådeincident").to_string()
            });
        state.event = None;
        reputation_delta -= 1;
        suspicion_delta += 2.5;
        state.civet_happiness -= 1.5;
        state.log_line(if state.language == Language::Swedish {
            format!("{title} löper ut i postlådan. Världen fortsätter snurra.")
        } else {
            format!("{title} times out in the mailbox. The world keeps spinning.")
        });
    }

    state.reputation += reputation_delta;
    state.suspicion += suspicion_delta;
    state.clamp();

    let title = if state.suspicion >= 85.0 {
        state_text(
            state,
            "Daily Report: Everyone Is Being Very Calm",
            "Dagsrapport: Alla är väldigt lugna",
        )
        .to_string()
    } else if state.civet_happiness < 40.0 {
        state_text(
            state,
            "Daily Report: Civet Morale Committee Convenes",
            "Dagsrapport: Palmmårdarnas moralkommitté sammanträder",
        )
        .to_string()
    } else if state.daily_sales >= 120 {
        state_text(
            state,
            "Daily Report: Premium Beans, Premium Questions",
            "Dagsrapport: Premiumbönor, premiumfrågor",
        )
        .to_string()
    } else {
        state_text(
            state,
            "Daily Report: Boring Coffee, Dramatic Shadows",
            "Dagsrapport: Tråkigt kaffe, dramatiska skuggor",
        )
        .to_string()
    };

    let summary = if state.language == Language::Swedish {
        format!(
            "Försäljning ${}. Driftkostnader ${}. Rykte {:+}. Misstanke {:+.1}%.",
            state.daily_sales, state.daily_expenses, reputation_delta, suspicion_delta
        )
    } else {
        format!(
            "Sales ${}. Operating costs ${}. Reputation {:+}. Suspicion {:+.1}%.",
            state.daily_sales, state.daily_expenses, reputation_delta, suspicion_delta
        )
    };
    let recommendation = day_recommendation(state, reputation_delta, suspicion_delta);

    state.log_line(if state.language == Language::Swedish {
        format!(
            "Slut på dag {day}: försäljning ${}, kostnader ${}, rykte {:+}, misstanke {:+.1}%.",
            state.daily_sales, state.daily_expenses, reputation_delta, suspicion_delta
        )
    } else {
        format!(
            "End of day {day}: sales ${}, costs ${}, reputation {:+}, suspicion {:+.1}%.",
            state.daily_sales, state.daily_expenses, reputation_delta, suspicion_delta
        )
    });

    state.daily_sales = 0;
    state.daily_expenses = 0;

    if state.money < -80 {
        state.game_result = Some(GameResult::Failed(
            state_text(
                state,
                "The plantation collapses under debt. The goat denies fiduciary responsibility.",
                "Plantagen kollapsar under skulder. Geten förnekar ekonomiskt ansvar.",
            )
            .to_string(),
        ));
    } else if state.reputation <= -8 {
        state.game_result = Some(GameResult::Failed(
            state_text(
                state,
                "Reputation bottoms out. Reviewers describe the coffee as 'procedurally concerning'.",
                "Ryktet bottnar. Recensenter beskriver kaffet som 'procedurmässigt oroande'.",
            )
            .to_string(),
        ));
    } else if day >= 7 {
        if state.money >= 320 && state.reputation >= 18 && state.suspicion < 80.0 {
            state.game_result = Some(GameResult::Won(
                state_text(
                    state,
                    "Seven days survived: profitable, reputable, and only moderately surveilled.",
                    "Sju dagar överlevda: lönsamt, ansett och bara måttligt övervakat.",
                )
                .to_string(),
            ));
        } else {
            state.game_result = Some(GameResult::Failed(
                state_text(
                    state,
                    "Seven days pass, but the board calls the result 'not yet investable'.",
                    "Sju dagar går, men styrelsen kallar resultatet 'ännu inte investerbart'.",
                )
                .to_string(),
            ));
        }
    } else {
        state.day += 1;
        assign_daily_modifier(state);
    }

    DayReport {
        day,
        title,
        summary,
        recommendation,
        upkeep,
        reputation_delta,
        suspicion_delta,
    }
}

fn day_recommendation(state: &GameState, reputation_delta: i32, suspicion_delta: f32) -> String {
    if state.inspection || state.suspicion >= 85.0 {
        return state_text(
            state,
            "Tomorrow starts with the authorities. Improve paperwork or spend coffee on a tasting.",
            "Morgondagen börjar med myndigheterna. Förbättra pappren eller lägg kaffe på en provning.",
        )
        .to_string();
    }
    if state.civet_happiness < 45.0 {
        return state_text(
            state,
            "Feed and care for the civets before chasing more production.",
            "Mata och ta hand om palmmårdarna innan du jagar mer produktion.",
        )
        .to_string();
    }
    if state.active_order.is_some() {
        return state_text(
            state,
            "Prioritize the active contract: roast enough bags and deliver from the roastery.",
            "Prioritera det aktiva kontraktet: rosta nog med säckar och leverera från rosteriet.",
        )
        .to_string();
    }
    if state.pending_order.is_some() || state.event.is_some() {
        return state_text(
            state,
            "Visit the paperwork office early; unanswered mail turns into penalties.",
            "Besök papperskontoret tidigt; obesvarad post blir straff.",
        )
        .to_string();
    }
    if state.roasted_coffee >= 4.0 {
        return state_text(
            state,
            "Sell roasted coffee while reputation is warm, then reinvest in care or paperwork.",
            "Sälj rostat kaffe medan ryktet är varmt, investera sedan i omsorg eller papper.",
        )
        .to_string();
    }
    if state.processed_beans >= 2.0 {
        return state_text(
            state,
            "Move beans through the roaster so tomorrow has money, not just inventory.",
            "Flytta bönorna genom rostaren så morgondagen har pengar, inte bara lager.",
        )
        .to_string();
    }
    if reputation_delta < 0 || suspicion_delta > 4.0 {
        return state_text(
            state,
            "Slow down and stabilize: paperwork, animal care, and modest sales will lower risk.",
            "Sakta ner och stabilisera: papper, djurvård och måttlig försäljning sänker risken.",
        )
        .to_string();
    }
    state_text(
        state,
        "Keep the pipeline moving: harvest fruit, feed civets, roast beans, then sell.",
        "Håll kedjan igång: skörda frukt, mata palmmårdar, rosta bönor och sälj.",
    )
    .to_string()
}

pub fn trigger_random_events(
    time: Res<Time>,
    mut timer: ResMut<EventTick>,
    mut state: ResMut<GameState>,
) {
    let delta = time.delta().mul_f32(state.time_scale.multiplier());
    if !timer.0.tick(delta).just_finished()
        || state.screen != GameScreen::Playing
        || state.inspection
        || state.event.is_some()
        || state.day_report.is_some()
        || state.game_result.is_some()
    {
        return;
    }

    let kind = match state.rand_index(12) {
        0 => RandomEventKind::PoliceVisit,
        1 => RandomEventKind::JournalistQuestions,
        2 => RandomEventKind::WelfareInspection,
        3 => RandomEventKind::HelicopterOverhead,
        4 => RandomEventKind::BinturongEscape,
        5 => RandomEventKind::PickyCivet,
        6 => RandomEventKind::GoatAppearance,
        7 => RandomEventKind::TouristGroup,
        8 => RandomEventKind::VeterinarianOffer,
        9 => RandomEventKind::Rainstorm,
        10 => RandomEventKind::InfluencerVisit,
        _ => RandomEventKind::PaperworkAudit,
    };

    state.event = Some(EventState {
        kind,
        title: event_title(kind, state.language).to_string(),
        body: event_body(kind, state.language).to_string(),
        due_day: (state.day + 2).min(7),
    });
    state.dirty_visuals = true;
    state.cue_audio(AudioCue::EventNotice);
    let due_day = state
        .event
        .as_ref()
        .map_or(state.day, |event| event.due_day);
    let event_message = if state.language == Language::Swedish {
        format!("Ny incident i papperskontoret: svara före slutet av dag {due_day}.")
    } else {
        format!("New office incident: respond before the end of day {due_day}.")
    };
    state.log_line(event_message);
}

fn event_title(kind: RandomEventKind, language: Language) -> &'static str {
    if language == Language::Swedish {
        match kind {
            RandomEventKind::PoliceVisit => "Lokalt polisbesök",
            RandomEventKind::JournalistQuestions => "Journalist ställer frågor",
            RandomEventKind::WelfareInspection => "Djurskyddsinspektion",
            RandomEventKind::HelicopterOverhead => "Helikopter ovanför",
            RandomEventKind::BinturongEscape => "Binturong rymmer",
            RandomEventKind::PickyCivet => "Palmmård vägrar frukt",
            RandomEventKind::GoatAppearance => "Oplanerad get",
            RandomEventKind::TouristGroup => "Turistgrupp vid grindarna",
            RandomEventKind::VeterinarianOffer => "Veterinär erbjuder hjälp",
            RandomEventKind::Rainstorm => "Skyfall över plantagen",
            RandomEventKind::InfluencerVisit => "Influencer vill filma",
            RandomEventKind::PaperworkAudit => "Pappersrevision",
        }
    } else {
        match kind {
            RandomEventKind::PoliceVisit => "Local Police Visit",
            RandomEventKind::JournalistQuestions => "Journalist Asks Questions",
            RandomEventKind::WelfareInspection => "Animal Welfare Inspection",
            RandomEventKind::HelicopterOverhead => "Helicopter Overhead",
            RandomEventKind::BinturongEscape => "Binturong Escape",
            RandomEventKind::PickyCivet => "Civet Refuses Fruit",
            RandomEventKind::GoatAppearance => "Unscheduled Goat",
            RandomEventKind::TouristGroup => "Tourist Group at the Gate",
            RandomEventKind::VeterinarianOffer => "Veterinarian Offers Help",
            RandomEventKind::Rainstorm => "Rainstorm Over the Plantation",
            RandomEventKind::InfluencerVisit => "Influencer Wants to Film",
            RandomEventKind::PaperworkAudit => "Paperwork Audit",
        }
    }
}

fn event_body(kind: RandomEventKind, language: Language) -> &'static str {
    if language == Language::Swedish {
        match kind {
            RandomEventKind::PoliceVisit => {
                "Två poliser kommer för att fråga varför den lagliga kaffeegendomen har perimeterplan och spegelsolglasögon."
            }
            RandomEventKind::JournalistQuestions => {
                "En reporter vill ha rundtur, citat och en rimlig förklaring till uttrycket 'bönkedja för ansvar'."
            }
            RandomEventKind::WelfareInspection => {
                "En djurskyddsinspektör har skrivplatta, bra skor och mycket specifika krav på palmmårdsberikning."
            }
            RandomEventKind::HelicopterOverhead => {
                "En helikopter cirklar lågt nog för att läsa kaffesäckarna och uttala 'palmmård' fel på radion."
            }
            RandomEventKind::BinturongEscape => {
                "Binturongen lämnar hägnet med en aktieägares tysta självförtroende."
            }
            RandomEventKind::PickyCivet => {
                "En palmmård avvisar dagens frukturval och håller ögonkontakt med alla ansvariga."
            }
            RandomEventKind::GoatAppearance => {
                "En get dyker upp i pappersrummet. Ingen anställde den. Ingen kan bevisa motsatsen."
            }
            RandomEventKind::TouristGroup => {
                "En buss med kaffeturister vill se fristaden, köpa påsar och ta alldeles för närgångna bilder."
            }
            RandomEventKind::VeterinarianOffer => {
                "En resande veterinär erbjuder en snabb hälsorond mot kontanter, byteskaffe eller ett bestämt nej."
            }
            RandomEventKind::Rainstorm => {
                "Regnet slår mot fältet. Skörden kan räddas, djuren kan lugnas eller pappren kan sorteras."
            }
            RandomEventKind::InfluencerVisit => {
                "En lokal influencer har hittat plantagen och uttalar redan 'autentiskt' framför kameran."
            }
            RandomEventKind::PaperworkAudit => {
                "En revisor vill jämföra kvitton, tanddiagram och varför geten har tre olika titlar."
            }
        }
    } else {
        match kind {
            RandomEventKind::PoliceVisit => {
                "Two officers arrive to ask why the legal coffee estate has a perimeter plan and mirrored sunglasses."
            }
            RandomEventKind::JournalistQuestions => {
                "A reporter wants a tour, a quote, and a plausible explanation for the phrase 'bean chain of custody'."
            }
            RandomEventKind::WelfareInspection => {
                "An animal welfare inspector has a clipboard, good shoes, and very specific civet enrichment expectations."
            }
            RandomEventKind::HelicopterOverhead => {
                "A helicopter circles low enough to read the coffee bags and mispronounce 'civet' on the radio."
            }
            RandomEventKind::BinturongEscape => {
                "The binturong exits its enclosure with the quiet confidence of a shareholder."
            }
            RandomEventKind::PickyCivet => {
                "A civet rejects today's fruit selection and makes eye contact with everyone responsible."
            }
            RandomEventKind::GoatAppearance => {
                "A goat appears inside the paperwork room. No one hired it. No one can prove that."
            }
            RandomEventKind::TouristGroup => {
                "A bus of coffee tourists wants to see the sanctuary, buy bags, and take very close photos."
            }
            RandomEventKind::VeterinarianOffer => {
                "A traveling veterinarian offers a quick health round for cash, barter coffee, or a firm no."
            }
            RandomEventKind::Rainstorm => {
                "Rain hammers the field. Harvest can be saved, animals can be soothed, or paperwork can be sorted."
            }
            RandomEventKind::InfluencerVisit => {
                "A local influencer has found the plantation and is already saying 'authentic' into a camera."
            }
            RandomEventKind::PaperworkAudit => {
                "An auditor wants to compare receipts, dental charts, and why the goat has three job titles."
            }
        }
    }
}
