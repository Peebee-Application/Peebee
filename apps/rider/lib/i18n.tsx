"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Language = "en" | "lg";

const STORAGE_KEY = "peebee-language";

// Starter dictionary — covers the always-visible chrome (nav, header,
// account). Translating every screen in both apps is a much bigger job;
// this wires up the mechanism and the switch so screens can be added to
// this dictionary incrementally without touching the plumbing again.
const STRINGS: Record<string, { en: string; lg: string }> = {
  nav_home: { en: "Home", lg: "Awaka" },
  nav_orders: { en: "Orders", lg: "Ebiragiddwa" },
  nav_jobs: { en: "Jobs", lg: "Emirimu" },
  nav_active: { en: "Active", lg: "Ebikola" },
  nav_chat: { en: "Chat", lg: "Emboozi" },
  nav_wallet: { en: "Wallet", lg: "Ensawo" },
  nav_account: { en: "Account", lg: "Akawunti" },
  account_title: { en: "Account", lg: "Akawunti" },
  appearance_title: { en: "Appearance", lg: "Endabika" },
  appearance_auto: { en: "Auto", lg: "Byokka" },
  appearance_light: { en: "Light", lg: "Ekyakaawo" },
  appearance_dark: { en: "Dark", lg: "Ekizikiza" },
  language_title: { en: "Language", lg: "Olulimi" },
  language_english: { en: "English", lg: "Olungereza" },
  language_luganda: { en: "Luganda", lg: "Oluganda" },
  log_out: { en: "Log out", lg: "Fuluma" },
  change_location: { en: "Change location", lg: "Kyusa ekifo" },
  locating: { en: "Locating…", lg: "Nnoonya ekifo…" },

  // Home / jobs
  loading: { en: "Loading…", lg: "Kaloze…" },
  home_online: { en: "Online", lg: "Ali ku layini" },
  home_offline: { en: "Offline", lg: "Tali ku layini" },
  home_available_jobs: { en: "Available jobs", lg: "Emirimu Egiriwo" },
  home_all: { en: "All", lg: "Byonna" },
  home_sort: { en: "Sort", lg: "Longoosa" },
  home_sort_nearest: { en: "Nearest first", lg: "Ebikumpi mu maaso" },
  home_sort_price_high: { en: "Price: high to low", lg: "Omuwendo: waggulu okugenda wansi" },
  home_sort_price_low: { en: "Price: low to high", lg: "Omuwendo: wansi okugenda waggulu" },
  home_sort_newest: { en: "Newest first", lg: "Ebipya mu maaso" },
  home_sort_oldest: { en: "Oldest first", lg: "Ebikadde mu maaso" },
  home_go_online: { en: "Go online to see nearby orders.", lg: "Yingira ku layini olabe ebiragiddwa ebikumpi." },
  home_no_jobs: { en: "No open orders near you right now.", lg: "Tewali biragiddwa ebiggule bikumpi naawe kaakano." },
  home_no_category_jobs: { en: "No {category} jobs right now.", lg: "Tewali mirimu gya {category} kaakano." },
  home_km_away: { en: "km away", lg: "km bweraka" },
  home_distance_unknown: { en: "Distance unknown", lg: "Ebweraka tebumanyiddwa" },
  home_delivery: { en: "delivery", lg: "okutuusa" },
  home_out_of_range: { en: "Outside the normal service area — you can propose a higher fee once you take it.", lg: "Ebweru w'ekitundu ekya bulijjo — osobola okuwaayo omuwendo omusukiddwa nga wakimaze okukikwata." },
  home_preview: { en: "Preview", lg: "Laba Olubereberye" },
  home_claiming: { en: "Claiming…", lg: "Tukwata…" },
  home_offline_btn: { en: "Offline", lg: "Tewali Intaneeti" },
  home_claim_job: { en: "Claim job", lg: "Kwata omulimu" },
  home_applying: { en: "Applying…", lg: "Tusaba…" },
  home_applied: { en: "Applied ✓", lg: "Osabye ✓" },
  home_apply: { en: "Apply", lg: "Saba" },
  bid_your_price: { en: "Your price (UGX)", lg: "Omuwendo gwo (UGX)" },
  bid_range: { en: "Allowed: {min} – {max}", lg: "Ekikkirizibwa: {min} – {max}" },
  bid_app_price: { en: "App price {price}", lg: "Omuwendo gwa app {price}" },
  bid_apply_at: { en: "Apply · {price}", lg: "Saba · {price}" },
  home_your_jobs: { en: "Your jobs", lg: "Emirimu gyo" },
  home_no_active_jobs: { en: "No active jobs yet — claim one above.", lg: "Tewali mulimu gukyakola — kwata ogumu waggulu." },
  home_hi: { en: "Hi", lg: "Ki kati" },
  home_availability: { en: "Available for jobs", lg: "Ndiwo okukola emirimu" },
  home_categories: { en: "Job categories", lg: "Ebika by'emirimu" },
  home_total: { en: "Total", lg: "Omugatte" },
  home_nearest: { en: "Nearest", lg: "Ebikumpi" },
  home_delivery_fee: { en: "Delivery fee", lg: "Ssente z'okutuusa" },
  home_continue_job: { en: "Continue job", lg: "Weeyongere n'omulimu" },
  home_pickup: { en: "Pickup", lg: "Ekifo eky'okukima" },
  home_view_savings: { en: "View your savings", lg: "Laba ssente zo ez'akaterekero" },

  // Account
  acc_verified: { en: "Verified", lg: "Akakasiddwa" },
  acc_pending: { en: "Pending", lg: "Alindirira" },
  acc_profile_waiting: { en: "Your profile is complete and waiting on an admin to verify it. You'll be able to see and claim jobs as soon as you're approved — no need to do anything else here.", lg: "Ebikwata ku ggwe bimaze okujjuzibwa era bilindirira omukulembeze okubikakasa. Ojja kusobola okulaba n'okukwata emirimu bwe banaakukkiriza — tewali kirala ky'oteekwa kukola wano." },
  acc_profile_incomplete: { en: "Complete your profile below — an admin can only review and approve you once every required field (marked *) is filled in.", lg: "Maliriza ebikwata ku ggwe wansi — omukulembeze asobola kwekenneenya n'okukkiriza ggwe bwe muba mumaze okujjuza buli kifo ekyetaagisa (ekiriko *)." },
  acc_personal_details: { en: "Personal details", lg: "Ebikwata ku ggwe" },
  acc_first_name: { en: "First name", lg: "Erinnya ery'olubereberye" },
  acc_name_id_guidance: { en: "Confirm or edit your name. It must be similar to the name on your ID for your account to be verified.", lg: "Kakasa oba kyusa erinnya lyo. Lirina okufaanana n'eriri ku ndagamuntu yo akawunti yo okukakasibwa." },
  acc_confirm_suggested_name: { en: "Confirm this name", lg: "Kakasa erinnya lino" },
  acc_last_name: { en: "Last name", lg: "Erinnya ery'enkomerero" },
  acc_email_optional: { en: "Email (optional)", lg: "Email (si kyetaagisa)" },
  acc_phone: { en: "Phone", lg: "Essimu" },
  acc_alt_phone: { en: "Alt. phone (optional)", lg: "Essimu endala (si kyetaagisa)" },
  acc_vehicle: { en: "Vehicle", lg: "Ekidduka" },
  acc_moto_reg: { en: "Motorcycle registration number", lg: "Nampuulu ya pikipiki" },
  acc_locations: { en: "Locations", lg: "Ebifo" },
  acc_stage_location: { en: "Stage location", lg: "Ekifo ky'esitendi" },
  acc_set_stage_map: { en: "Set your stage location on the map", lg: "Teekawo ekifo ky'esitendi yo ku mabu" },
  acc_home_address: { en: "Home address", lg: "Ekifo ky'eka" },
  acc_stage_details: { en: "Stage details", lg: "Ebikwata ku sitendi" },
  acc_stage_name: { en: "Stage name", lg: "Erinnya ly'esitendi" },
  acc_stage_chairman_name: { en: "Stage chairman name", lg: "Erinnya lya cheyaman w'esitendi" },
  acc_stage_chairman_contact: { en: "Stage chairman contact", lg: "Essimu ya cheyaman w'esitendi" },
  acc_emergency_name: { en: "Emergency contact name", lg: "Erinnya ly'omuntu ow'oku lukyalo" },
  acc_emergency_phone: { en: "Emergency contact phone", lg: "Essimu y'omuntu ow'oku lukyalo" },
  acc_payout: { en: "Payout", lg: "Okusasulwa" },
  acc_save_numbers: { en: "Save up to 2 numbers your wallet withdrawals can go to.", lg: "Kuuma essimu ezitasukka bbiri ssente z'omu nsawo ze zisobola okugendako." },
  acc_legacy_number: { en: "Legacy single number (optional)", lg: "Ssimu emu ey'edda (si kyetaagisa)" },
  acc_momo_number: { en: "Mobile money number", lg: "Essimu ya sente ez'oku ssimu" },
  acc_network_detected: { en: "detected", lg: "ezuuliddwa" },
  acc_fallback_note: { en: "Only used as a fallback if you haven't saved any numbers above.", lg: "Ekozesebwa nga tewali ssimu zaakuumibwa waggulu." },
  acc_saving: { en: "Saving…", lg: "Tukuuma…" },
  acc_save_profile: { en: "Save profile", lg: "Kuuma ebikwata ku ggwe" },
  acc_saved: { en: "Saved.", lg: "Kikuumiddwa." },
  acc_profile_photo: { en: "Profile photo", lg: "Ekifaananyi kyo" },
  acc_photo_note: { en: "A clear photo of your face — this is what customers see once you take their order, so they know who's arriving.", lg: "Ekifaananyi ekirambika eky'amaaso go — kino kye bakasitoma balaba nga bakukwasa ekiragiddwa kyabwe, basobole okumanya ani ajja." },
  acc_uploading: { en: "Uploading…", lg: "Tuwaayo…" },
  acc_uploaded_replace: { en: "Uploaded — tap to replace", lg: "Kiwaayibwa — nyiga okyuse" },
  acc_add_photo: { en: "Add profile photo", lg: "Ongeza ekifaananyi kyo" },
  acc_national_id: { en: "National ID", lg: "Endagamuntu" },
  acc_id_note: { en: "Used only to verify your identity. It is never shown publicly or shared outside admin review.", lg: "Ekozesebwa kukakasa buggwe bwo bwokka. Tekirabisibwa ku lujjudde oba okugabanibwa ebweru w'okwekenneenya kw'omukulembeze." },
  acc_attach_id: { en: "Attach ID snapshot/scan", lg: "Gattako ekifaananyi ky'endagamuntu" },
  acc_close_account: { en: "Close my account", lg: "Ggalawo akawunti yange" },
  acc_close_confirm_title: { en: "Close your account?", lg: "Oggalawo akawunti yo?" },
  acc_close_confirm_note: { en: "Your entire wallet balance — including any minimum reserve — is paid out to your mobile money number on file, then your account is locked. You'll need to contact support to reopen it. This can't be undone from here, and only works if you don't have a job in progress.", lg: "Ssente zonna ez'omu nsawo yo — nga mw'otwaliddemu n'ekkomo ery'obutasingako — zisasulwa ku ssimu yo ey'ssente ekwatiddwa, oluvannyuma akawunti yo n'eggalibwa. Ojja kwetaaga okutuukirira obuyambi okugizibula. Kino tekisobola kukyusibwa wano, era kikola bwoba tolina mulimu ogukyakolebwa." },
  acc_closing: { en: "Closing…", lg: "Tuggalawo…" },
  acc_yes_close: { en: "Yes, close my account", lg: "Yee, ggalawo akawunti yange" },
  acc_cancel: { en: "Cancel", lg: "Sazaamu" },
  acc_sub_paid_once: { en: "Your one-time subscription is paid — active for good.", lg: "Omuwendo gwo ogw'omulundi gumu gusasuliddwa — gukola bulijjo." },
  acc_sub_active_through: { en: "Subscription active through {date}. Renews automatically at {amount} UGX/{cadence}.", lg: "Ogwo ogw'obwegasse gukyakola okutuusa {date}. Guddamu gukoleddwa buteredde ku {amount} UGX/{cadence}." },
  acc_sub_active: { en: "Subscription active. Renews automatically at {amount} UGX/{cadence}.", lg: "Ogwo ogw'obwegasse gukola. Guddamu gukoleddwa buteredde ku {amount} UGX/{cadence}." },
  acc_sub_failed: { en: "Subscription payment failed", lg: "Okusasula ogwo ogw'obwegasse kulemereddwa" },
  acc_sub_activate: { en: "Activate your subscription", lg: "Tandika ogwo ogw'obwegasse" },
  acc_sub_pay_once: { en: "Pay a one-time {amount} UGX fee to start claiming and applying for jobs — no renewals, ever.", lg: "Sasula {amount} UGX omulundi gumu okutandika okukwata n'okusaba emirimu — tewali kuddamu, emirembe gyonna." },
  acc_sub_pay_recurring: { en: "Pay {amount} UGX/{cadence} to start claiming and applying for jobs. Charged to your mobile money number on file.", lg: "Sasula {amount} UGX/{cadence} okutandika okukwata n'okusaba emirimu. Kisasulwa ku ssimu yo ey'ssente ekwatiddwa." },
  acc_sub_confirming: { en: "Confirming…", lg: "Tukakasa…" },
  acc_sub_sending: { en: "Sending…", lg: "Tuweereza…" },
  acc_sub_pay: { en: "Pay {amount} UGX", lg: "Sasula {amount} UGX" },
  cadence_daily: { en: "day", lg: "lunaku" },
  cadence_weekly: { en: "week", lg: "wiiki" },
  cadence_monthly: { en: "month", lg: "mwezi" },
  // Wallet
  wallet_title: { en: "Wallet", lg: "Ensawo" },
  wallet_withdrawal_processing: { en: "Processing", lg: "Ekolebwa" },
  wallet_withdrawal_paid: { en: "Paid out", lg: "Kisasuliddwa" },
  wallet_withdrawal_failed: { en: "Failed — refunded", lg: "Kigaanye — kizzeddwa" },
  wallet_topup_title: { en: "Top up to keep taking jobs", lg: "Teekamu ssente okusigala nga okwata emirimu" },
  wallet_topup_note: {
    en: "A cash order's platform fee came out of your required deposit. You're short {shortfall} of the {required} minimum — top up to claim or apply for new jobs again.",
    lg: "Omusolo gw'ekyakozesebwa ku odaala ey'ssente ez'omukono gwaggiddwa mu ssente zo ez'obutebenkevu. Obulinako {shortfall} ku {required} ez'obutasingako — teekamu ssente okusobola okukwata oba okusaba emirimu emipya nate.",
  },
  wallet_topup_confirming: { en: "Confirming your top-up…", lg: "Tukakasa okuteekamu ssente zo…" },
  wallet_topup_placeholder: { en: "Mobile money number, e.g. 0772345678", lg: "Ennamba y'ssente ku ssimu, gamba nga 0772345678" },
  wallet_topup_starting: { en: "Starting…", lg: "Tutandika…" },
  wallet_topup_button: { en: "Top up {amount}", lg: "Teekamu {amount}" },
  wallet_balance: { en: "Wallet balance", lg: "Ssente ezisigaddewo mu nsawo" },
  wallet_balance_note: { en: "Escrow payouts land here — cash jobs pay you directly, on the spot.", lg: "Ssente ez'okusasulwa mu escrow zituuka wano — emirimu egy'ssente ez'omukono gukusasula butereevu, ekifo n'ekiseera." },
  wallet_balance_negative_note: {
    en: "A negative balance is a cash-order platform fee — it'll be covered automatically by your next digital job's payout.",
    lg: "Ssente ez'obutasingako mu bbalansi lye musolo gw'ekyakozesebwa ku odaala ey'ssente ez'omukono — zijja kusasulwa buteredde okuva ku kusasulwa kw'omulimu gwo oguddako ogw'ssimu.",
  },
  wallet_reserve_note: {
    en: "A minimum of {reserve} always stays in your wallet — up to {available} is available to withdraw right now.",
    lg: "Obutasingako bwa {reserve} bubeera mu nsawo yo bulijjo — okutuusa {available} kisoboka okuggyibwa kati.",
  },
  wallet_withdraw_to: { en: "Withdraw to", lg: "Ggyayo ku" },
  wallet_amount_label: { en: "Amount to withdraw (UGX) — leave blank to withdraw the full available amount", lg: "Omuwendo okuggyayo (UGX) — leka ekifo we kimu okuggyayo ssente zonna eziriwo" },
  wallet_withdraw_amount: { en: "Withdraw amount", lg: "Ggyayo omuwendo" },
  wallet_withdraw_all: { en: "Withdraw all", lg: "Ggyayo zonna" },
  wallet_sending: { en: "Sending…", lg: "Tuweereza…" },
  wallet_choose_number: { en: "Choose which number to withdraw to.", lg: "Londa ennamba y'okuggyayoko." },
  wallet_withdrawals_header: { en: "Withdrawals", lg: "Okuggyayo" },
  wallet_job_history: { en: "Job history · {total} lifetime", lg: "Ebyafaayo by'emirimu · {total} byonna" },
  wallet_no_completed_jobs: { en: "No completed jobs yet.", lg: "Tewali mulimu gumaliddwa." },
  wallet_job_fallback: { en: "Job #{id}", lg: "Omulimu #{id}" },
  // Chat
  chat_title: { en: "Chat", lg: "Emboozi" },
  chat_loading: { en: "Loading…", lg: "Tulinda…" },
  chat_empty: { en: "No conversations yet — they'll show up here once you take a job.", lg: "Tewali mboozi nabwo — zijja kulabika wano bw'okwata omulimu." },
  chat_load_error: { en: "Couldn't load this conversation.", lg: "Tetusobodde kuleeta emboozi eno." },
  chat_back_to_chats: { en: "Back to chats", lg: "Ddayo ku mboozi" },
  chat_no_answer: { en: "No answer", lg: "Tewali kuddamu" },
  chat_voice_loading: { en: "Loading…", lg: "Tulinda…" },
  chat_voice_error: { en: "Couldn't play — tap to retry", lg: "Tetusobodde kukuba — nyiga oddemu" },
  chat_voice_message: { en: "Voice message", lg: "Obubaka bw'eddoboozi" },
  chat_message_placeholder: { en: "Message…", lg: "Obubaka…" },
  // Job detail
  job_loading: { en: "Loading job…", lg: "Tulinda omulimu…" },
  job_pickup: { en: "Pickup: {area}", lg: "Okukima: {area}" },
  job_deliver_to: { en: "Deliver to: ", lg: "Watikka: " },
  job_shopping_list: { en: "Shopping list", lg: "Olukalala lw'okugula" },
  job_est_each: { en: "Est. {amount} each", lg: "Wakiri {amount} buli emu" },
  job_undo: { en: "Undo", lg: "Zzaayo" },
  job_not_available_remove: { en: "Not available — remove from list", lg: "Tekiriwo — kiggye ku lukalala" },
  job_not_available: { en: "Not available", lg: "Tekiriwo" },
  job_replace_with: { en: "Replace with…", lg: "Kikyuse ne…" },
  job_price_change: { en: "Price change", lg: "Enkyukakyuka y'omuwendo" },
  job_save_change: { en: "Save change", lg: "Tereka enkyukakyuka" },
  job_items_total: { en: "Items total", lg: "Omuwendo gw'ebintu" },
  job_delivery_fee: { en: "Delivery fee", lg: "Omusolo gw'okutuusa" },
  job_changes_count: { en: "{count} change{plural} · {sign}{amount}", lg: "{count} enkyukakyuka{plural} · {sign}{amount}" },
  job_send_for_approval: { en: "Send for approval", lg: "Weereza okukakasibwa" },
  job_you_suggested_fee: { en: "You suggested a delivery fee of {amount}", lg: "Wasazeewo omusolo gw'okutuusa gwa {amount}" },
  job_waiting: { en: "Waiting", lg: "Tulindirira" },
  job_suggest_different_fee: { en: "Suggest a different delivery fee", lg: "Sazaawo omusolo omulala ogw'okutuusa" },
  job_new_delivery_fee_label: { en: "New delivery fee (UGX) — items cost isn't affected", lg: "Omusolo omupya ogw'okutuusa (UGX) — omuwendo gw'ebintu tegukyusibwa" },
  job_currently: { en: "Currently {amount}.", lg: "Kati {amount}." },
  job_reason_optional: { en: "Reason (optional, typed)", lg: "Ensonga (si kyetaagisa, ewandiikibwa)" },
  job_type_reason_placeholder: { en: "Type a reason in English…", lg: "Wandiika ensonga mu Lungereza…" },
  job_or_record_voice_reason: { en: "Or record a voice reason (any language)", lg: "Oba kuba eddoboozi ery'ensonga (olulimi lwonna)" },
  job_cancel: { en: "Cancel", lg: "Sazaamu" },
  job_send_to_customer: { en: "Send to customer", lg: "Weereza eri omusuubuzi" },
  job_waiting_on_customer_fund: { en: "Waiting on the customer to fund this order.", lg: "Tulindirira omusuubuzi okusasula ogu ogutundibwa." },
  job_tap_pencil_hint: { en: "Tap the pencil next to an item above if something's unavailable or costs more.", lg: "Nyiga akapensulo okumpi n'ekintu waggulu bwe wabaawo ekitali kiriwo oba ekisingako." },
  job_eta_placeholder: { en: "ETA (min)", lg: "Ebbanga (edak.)" },
  job_start_delivery: { en: "Start delivery", lg: "Tandika okutuusa" },
  job_heading_pickup_passenger: {
    en: "Heading to pick up your passenger{eta}. Navigate there, then confirm once you've arrived.",
    lg: "Tugenda okukima omugenzi wo{eta}. Yita eyo, oluvannyuma kakasa bw'otuuseeyo.",
  },
  job_on_the_way: {
    en: "On the way{eta}. Navigate to the customer, then confirm once you've arrived.",
    lg: "Tuli mu kugenda{eta}. Yita ku musuubuzi, oluvannyuma kakasa bw'otuuseeyo.",
  },
  job_confirm_pickup: { en: "Confirm Pickup", lg: "Kakasa Okukima" },
  job_confirm_delivery: { en: "Confirm Delivery", lg: "Kakasa Okutuusa" },
  job_confirm_pickup_desc: { en: "Confirms you've reached your passenger. They'll be notified you're here.", lg: "Kikakasa nga otuuse ku mugenzi wo. Bajja kutegeezebwa nga wooli." },
  job_confirm_delivery_desc: {
    en: "Confirms you've reached the customer and marks this job as arrived. They'll be notified to confirm handover on their end.",
    lg: "Kikakasa nga otuuse ku musuubuzi era kiteeka omulimu nga gutuuse. Bajja kutegeezebwa okukakasa okuwaayo ku ludda lwabwe.",
  },
  job_passenger_notified: { en: "Your passenger's been notified you're here.", lg: "Omugenzi wo ategeezeddwa nga wooli." },
  job_confirm_passenger_picked_up: { en: "Confirm passenger picked up", lg: "Kakasa omugenzi akimiddwa" },
  job_customer_notified_handover: { en: "The customer's been notified you're here. Ask them to confirm handover in their app.", lg: "Omusuubuzi ategeezeddwa nga wooli. Mubuulire akakase okuwaayo mu app ye." },
  job_heading_destination: { en: "Heading to the destination. The trip completes once your passenger confirms in their app.", lg: "Tugenda gy'oteekwa okutuuka. Olugendo lumalirira nga omugenzi akakasizza mu app ye." },
  job_trip_complete: { en: "Trip Complete", lg: "Olugendo Lumaliddwa" },
  job_trip_complete_desc: {
    en: "Marks the trip as finished on your end. The passenger still needs to confirm in their own app to release payment.",
    lg: "Kiteeka olugendo nga lumaliddwa ku ludda lwo. Omugenzi akyetaaga okukakasa mu app ye okusumulula okusasula.",
  },
  job_handover_confirmed: { en: "Handover confirmed. Collect your payout.", lg: "Okuwaayo kukakasiddwa. Toola ssente zo." },
  job_settle_get_paid: { en: "Settle & get paid", lg: "Maliriza & osasulwe" },
  job_you_earned: { en: "You earned", lg: "Wafuna" },
  job_plus_reimbursed: {
    en: "Plus {reimbursed} reimbursed for items — {total} total settled to your wallet.",
    lg: "Ate ne {reimbursed} ezaddizibwa ku bintu — {total} zonna zisasuliddwa mu nsawo yo.",
  },
  job_wallet_balance_label: { en: "Wallet balance: ", lg: "Ssente mu nsawo: " },
  active_title: { en: "Active", lg: "Egyekola" },
  active_loading: { en: "Loading…", lg: "Tulinda…" },
  active_none: { en: "No active jobs right now.", lg: "Tewali mulimu gukola kati." },
  job_back_to_jobs: { en: "Back to Jobs", lg: "Ddayo ku Mirimu" },
  job_cancel_this_job: { en: "Cancel this job", lg: "Sazaamu omulimu guno" },
  job_cancel_note: { en: "This job goes back to the pool for another rider. You won't be offered it again.", lg: "Omulimu guno guddayo mu kabbo ka mugenzi omulala. Toojjukulakko nate." },
  job_keep_job: { en: "Keep job", lg: "Kwata omulimu" },
  job_yes_cancel: { en: "Yes, cancel", lg: "Yee, sazaamu" },
  job_open_fullscreen_chat: { en: "Open full-screen chat", lg: "Zibula emboozi eyeetuuse yonna" },
};

export type TranslationKey = keyof typeof STRINGS;

function readStored(): Language {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "en" || v === "lg") return v;
  } catch {}
  return "en";
}

const LanguageContext = createContext<{ language: Language; setLanguage: (l: Language) => void }>({
  language: "en",
  setLanguage: () => {},
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  useEffect(() => {
    setLanguageState(readStored());
  }, []);

  function setLanguage(next: Language) {
    setLanguageState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }

  return <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}

export function useTranslate() {
  const { language } = useLanguage();
  return (key: TranslationKey, params?: Record<string, string | number>) => {
    const template = STRINGS[key]?.[language] ?? STRINGS[key]?.en ?? key;
    if (!params) return template;
    return Object.entries(params).reduce(
      (text, [name, value]) => text.replace(`{${name}}`, String(value)),
      template,
    );
  };
}
