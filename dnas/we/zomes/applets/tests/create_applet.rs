use ::fixt::prelude::fixt;
use std::collections::BTreeMap;

use hdk::prelude::holo_hash::*;
use hdk::prelude::*;
use holochain::test_utils::consistency_10s;
use holochain::{conductor::config::ConductorConfig, sweettest::*};
use applets::{RegisterAppletInput, Applet};

#[tokio::test(flavor = "multi_thread")]
async fn create_applet() {
    // Use prebuilt DNA file
    let dna_path = std::env::current_dir()
        .unwrap()
        .join("../../workdir/we.dna");
    let dna = SweetDnaFile::from_bundle(&dna_path).await.unwrap();

    // Set up conductors
    let mut conductors = SweetConductorBatch::from_config(2, ConductorConfig::default()).await;
    let apps = conductors.setup_app("we", &[dna]).await.unwrap();
    conductors.exchange_peer_info().await;

    let ((alice,), (bobbo,)) = apps.into_tuples();

    let alice_zome = alice.zome("applets");
    let bob_zome = bobbo.zome("applets");

    let applet = Applet {
        name: String::from("name"),
        description: String::from("description"),
        logo_src: None,
        devhub_happ_release_hash: fixt!(EntryHashB64),
        gui_file_hash: fixt!(EntryHashB64),
        properties: BTreeMap::new(), // Segmented by RoleId
        uid: BTreeMap::new(),        // Segmented by RoleId
        dna_hashes: BTreeMap::new(), // Segmented by RoleId
    };
    let input = RegisterAppletInput {
        applet_agent_pub_key: alice.agent_pubkey().clone().into(),
        applet,
    };

    let _entry_hash: EntryHashB64 = conductors[0]
        .call(&alice_zome, "create_applet", input)
        .await;

    consistency_10s(&[&alice, &bobbo]).await;

    let all_applets: BTreeMap<EntryHashB64, Applet> =
        conductors[1].call(&bob_zome, "get_all_applets", ()).await;

    assert_eq!(all_applets.keys().len(), 1);
}
