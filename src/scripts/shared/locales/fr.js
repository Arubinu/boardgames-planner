// locales/fr.js
// Dictionnaire français (langue par défaut du site).
// Les clés sont organisées par zone fonctionnelle. Les valeurs contenant du
// balisage HTML portent le suffixe `_html` et sont injectées via innerHTML
// (voir applyI18n dans i18n.js). Les variantes `_one` / `_other` servent à la
// pluralisation (Intl.PluralRules).

export default {
  nav: {
    home: 'Accueil',
    dates: 'Prochaines dates',
    games: 'Nos jeux',
    infos: 'Infos pratiques',
    back: '← Retour au site',
    logout: 'Déconnexion',
    admin: 'Administration',
    menu: 'Menu',
    theme: 'Thème',
    lang: 'Langue',
  },

  hero: {
    script: "On vous attend autour d'une table !",
    title_html: 'Les <span class="accent">soirées jeux</span><br />de la MJC Estrablin',
    subtitle:
      'Retrouvez les prochaines dates, découvrez la ludothèque disponible et venez partager un bon moment autour des jeux de société.',
    cta_dates: 'Voir les prochaines dates',
    cta_games: 'Parcourir les jeux',
  },

  dates: {
    title: 'Prochaines soirées',
    sub_1: 'Cliquez sur une soirée pour la situer dans le calendrier et voir le lieu.',
    sub_2_html: 'Le bouton <u>« Voir les jeux de cette soirée »</u> en ouvre le détail.',
    past_toggle: 'Voir aussi les soirées passées',
    map_default: 'Sélectionnez une date pour voir le lieu.',
    map_none: 'Aucune soirée à cette date.',
    coords_missing: 'Coordonnées du lieu non renseignées.',
    none_upcoming: 'Aucune date programmée pour le moment. Revenez bientôt !',
    none_past: 'Aucune soirée passée.',
    load_error: 'Impossible de charger les dates ({error}).',
  },

  gamesPreview: {
    title: 'Notre ludothèque',
    sub_default: 'Une sélection parmi les jeux de la collection.',
    sub_count:
      '{count} jeux dans la collection — voici quelques pépites les mieux notées.',
    see_all: 'Voir tous les jeux →',
    none: 'Aucun jeu pour le moment.',
    error: '{error}',
  },

  infos: {
    title: 'Infos pratiques',
    sub: 'Deux formats de soirées, deux ambiances. À vous de choisir !',
    types_title: 'Deux types de soirées',
    types_desc_html:
      '<p><strong>Grandes soirées</strong> — début du mois, 19h-23h, salle festive, sans inscription, plat + boisson à apporter.</p><p><strong>Petites soirées</strong> — mi-mois, 20h-23h, local de la MJC, sur inscription (14 max), nourriture facultative.</p>',
    locations_title: 'Nos lieux',
    locations_soon: 'À venir.',
    location_map_link: 'Voir sur la carte ↗',
    contact_title: 'Contact & inscription',
    email_html:
      'Email : <a href="mailto:mjc.estrablin38@gmail.com">mjc.estrablin38@gmail.com</a>',
    contact_wa: 'Les inscriptions aux petites soirées se font via le groupe WhatsApp.',
    wa_main: 'Groupe « Soirées Jeux »',
    wa_mjc: 'Groupe MJC Estrablin',
    wa_todo: 'Liens WhatsApp à configurer en administration.',
    faq_title: 'Questions fréquentes',
  },

  faq: [
    {
      q: 'Quelle est la différence entre les deux types de soirées ?',
      a: "Les grandes soirées (début du mois) sont ouvertes à tous sans inscription, en salle festive, avec un plat et une boisson à apporter. Les petites soirées (mi-mois) sont pour adultes et sur inscription (14 places), au local de la MJC, nourriture facultative.",
    },
    {
      q: "Comment s'inscrire aux petites soirées ?",
      a: "Via le groupe WhatsApp « Soirées Jeux » ou par email à mjc.estrablin38@gmail.com. Les places sont limitées à 14 personnes, pensez à vous inscrire à l'avance.",
    },
    {
      q: 'Puis-je venir sans inscription ?',
      a: "Oui pour les grandes soirées du début du mois. Pour les petites soirées, l'inscription est obligatoire (places limitées).",
    },
    {
      q: 'Y a-t-il des jeux pour les débutants ?',
      a: 'Bien sûr ! La ludothèque couvre tous les niveaux, et les petites soirées sont idéales pour apprendre tranquillement.',
    },
    {
      q: 'Puis-je venir seul(e) ?',
      a: "Absolument, c'est l'occasion parfaite de rencontrer d'autres passionnés. On forme les tables selon les envies de chacun.",
    },
  ],

  join: {
    title: 'Adhérer à la MJC',
    desc_1: "L'adhésion à la MJC donne accès à l'ensemble des activités, dont les soirées jeux de société.",
    desc_2: 'Téléchargez le bulletin, remplissez-le et remettez-le sur place avec votre règlement.',
    cta: 'Télécharger le bulletin d\'adhésion (PDF)',
  },

  event: {
    games_count_one: '{count} jeu prévu',
    games_count_other: '{count} jeux prévus',
    time_tbd: 'Horaire à confirmer',
    available: 'Jeux disponibles ({count})',
    games_soon: 'La liste des jeux sera précisée prochainement.',
    see_games: 'Voir les jeux de cette soirée',
    register_wa: "S'inscrire via WhatsApp",
    type_inscription: '{label} — {sub}',
    loading: 'Chargement…',
    load_error: 'Erreur : {error}',
  },

  game: {
    min: 'min',
    players_label: 'joueurs',
    see_full: 'Voir la fiche complète ↗',
    rating_out_of: '★ {rating} / 10',
    subtitle: 'Sous-titre',
    players: 'Joueurs',
    duration: 'Durée',
    age: 'Âge',
    categories: 'Catégories',
    themes: 'Thèmes',
    mechanisms: 'Mécanismes',
    authors: 'Auteur(s)',
    publishers: 'Éditeur(s)',
    owner: 'Apporté par',
    no_preview_1: 'AUCUN',
    no_preview_2: 'APERÇU',
    ext: 'Extension',
    ext_short: 'ext.',
  },

  gamesPage: {
    hero_title: 'Notre ludothèque',
    intro_default: 'Tous les jeux disponibles lors de nos soirées.',
    intro_count:
      '{count} jeux disponibles lors de nos soirées — cliquez pour les détails.',
    search_ph: 'Rechercher un jeu, une catégorie, un thème…',
    sort_title: 'Trier par titre (A→Z)',
    sort_rating: 'Trier par note',
    chip_all: 'Tous',
    chip_base: 'Jeux de base',
    chip_ext: 'Extensions',
    count_one: '{count} jeu affiché',
    count_other: '{count} jeux affichés',
    none: 'Aucun jeu ne correspond à votre recherche.',
    load_error: 'Impossible de charger les jeux ({error}).',
    load_more: 'Défilez pour charger plus de jeux…',
    all_shown: 'Tous les jeux sont affichés ({count}).',
    footer_data: 'Données issues de la collection MyLudo de la MJC Estrablin.',
  },

  footer: {
    tagline: 'Des soirées conviviales pour partager la passion des jeux de société.',
    admin_link: 'Administration',
    back_home: "Retour à l'accueil",
  },

  modal: {
    event_title: 'Soirée',
    game_title: 'Jeu',
    close: 'Fermer',
  },

  meta: {
    index_title: 'Soirées Jeux — Soirées Jeux MJC Estrablin',
    games_title: 'Nos jeux — Soirées Jeux MJC Estrablin',
    admin_title: 'Administration — Soirées Jeux MJC Estrablin',
  },

  admin: {
    login_title: 'Espace administration',
    login_sub: 'Entrez le mot de passe pour gérer les dates et la ludothèque.',
    login_pwd: 'Mot de passe',
    login_btn: 'Se connecter',
    login_bad: 'Mot de passe incorrect',
    login_wait: 'Trop de tentatives. Réessayez dans {n} s.',

    stat_events: 'soirées',
    stat_games: 'jeux',
    stat_locations: 'lieux',

    tab_events: '📅 Soirées',
    tab_games: '🎲 Jeux & import',
    tab_locations: '📍 Lieux',
    tab_types: '🏷️ Types de soirées',
    tab_settings: '⚙️ Réglages',

    events_title: 'Soirées',
    upcoming_events_title: 'À venir',
    past_events_title: 'Soirées passées',
    new_event: '+ Nouvelle soirée',
    th_event: 'Soirée',
    th_type: 'Type',
    th_location: 'Lieu',
    th_games: 'Jeux',
    no_events: 'Aucune soirée. Créez-en une !',
    no_past_events: 'Aucune soirée passée.',
    games_unit_one: '{count} jeu',
    games_unit_other: '{count} jeux',

    games_import_title: 'Importer la collection MyLudo',
    import_help:
      "Exportez votre collection depuis MyLudo (format CSV ou JSON) puis déposez le fichier ici. Les images et « apporté par » saisis manuellement sont conservés lors d'une mise à jour.",
    dropzone_html: '<strong>Cliquez ou glissez un fichier</strong> (.csv ou .json)',
    import_mode: "Mode d'import",
    import_replace: 'Remplacer toute la collection',
    import_merge: 'Mettre à jour / compléter (fusion)',
    import_btn: 'Importer',
    games_list_title: 'Jeux',
    games_filter_ph: 'Filtrer…',
    th_game: 'Jeu',
    th_rating: 'Note',
    th_image: 'Image',
    th_owner: 'Apporté par',
    th_dates: 'Créé / Modifié',
    no_games: 'Aucun jeu. Importez votre collection MyLudo ci-dessus.',
    games_limited: 'Affichage limité à 300 lignes. Utilisez le filtre.',

    locations_title: 'Lieux',
    new_location: '+ Nouveau lieu',
    th_name: 'Nom',
    th_address: 'Adresse',
    th_coords: 'Coordonnées',
    no_active_loc: 'Aucun lieu actif.',
    archived_title: 'Lieux archivés',
    no_archived_loc: 'Aucun lieu archivé.',
    coords_undefined: 'non définies',

    // Types de soirées
    types_title: 'Types de soirées',
    new_type: '+ Nouveau type',
    types_help:
      "Chaque type définit un libellé, une mention, une couleur et s'il propose une inscription WhatsApp.",
    th_type_label: 'Libellé',
    th_type_sub: 'Mention',
    th_type_signup: 'Inscription',
    no_types: 'Aucun type de soirée.',
    yes: 'Oui',
    no: 'Non',
    tf_new: 'Nouveau type',
    tf_edit: 'Modifier le type',
    tf_label: 'Libellé *',
    tf_label_ph: 'Grande soirée',
    tf_sub: 'Mention',
    tf_sub_ph: 'sur inscription',
    tf_color: 'Couleur',
    tf_signup: 'Propose une inscription WhatsApp',
    err_type_label: 'Libellé obligatoire',
    saved_type: 'Type enregistré',
    del_type_title: 'Supprimer le type',
    del_type_msg:
      'Voulez-vous vraiment supprimer le type <strong>{label}</strong> ? (refusé si des soirées l\'utilisent)',
    del_type_done: 'Type supprimé',

    settings_title: 'Réglages',
    set_wa_main: 'Lien groupe WhatsApp « Soirées Jeux »',
    set_wa_mjc: 'Lien groupe WhatsApp « MJC Estrablin »',
    set_myludo: 'Profil MyLudo (lien public)',
    set_pwd: 'Nouveau mot de passe admin (laisser vide pour ne pas changer)',
    save_settings: 'Enregistrer les réglages',

    ef_new: 'Nouvelle soirée',
    ef_edit: 'Modifier la soirée',
    ef_duplicate: 'Dupliquer la soirée',
    duplicate: 'Dupliquer',
    ef_title: 'Titre *',
    ef_title_ph: 'Grande soirée jeux',
    ef_date: 'Date *',
    ef_type: 'Type',
    ef_start: 'Heure de début',
    ef_end: 'Heure de fin',
    ef_location: 'Lieu',
    ef_location_none: '— Aucun —',
    ef_desc: 'Description',
    ef_wa: "Lien WhatsApp d'inscription (optionnel)",
    ef_wa_ph: 'laisser vide pour utiliser le lien par défaut',
    ef_games_label: 'Jeux disponibles ce soir-là —',
    ef_selected: 'sélectionné(s)',
    ef_filter_ph: 'Filtrer les jeux…',

    lf_new: 'Nouveau lieu',
    lf_edit: 'Modifier le lieu',
    lf_name: 'Nom *',
    lf_name_ph: 'Salle festive',
    lf_address: 'Adresse',
    lf_desc: 'Description',
    lf_map_label: 'Emplacement sur la carte *',
    lf_map_help:
      "Cliquez sur la carte pour placer un repère à l'endroit exact du lieu. Les coordonnées sont enregistrées automatiquement.",
    lf_coords_prompt: 'Cliquez sur la carte pour placer le lieu.',
    lf_coords: 'Coordonnées : {coords}',

    gf_title: 'Modifier un jeu',
    gf_image: "URL d'image (optionnel)",
    gf_image_ph: 'https://...',
    gf_image_help:
      "Collez l'adresse d'une image de couverture (clic droit → « Copier l'adresse de l'image » sur MyLudo par exemple).",
    gf_owner: 'Apporté par / propriétaire',

    cm_title: 'Confirmer',
    cancel: 'Annuler',
    save: 'Enregistrer',
    confirm: 'Confirmer',
    edit: 'Éditer',
    delete: 'Supprimer',
    details: 'Détails',
    archive: 'Archiver',
    unarchive: 'Désarchiver',

    del_event_title: 'Supprimer la soirée',
    del_event_msg: 'Voulez-vous vraiment supprimer la soirée <strong>{label}</strong> ?',
    del_event_done: 'Soirée supprimée',
    del_game_title: 'Supprimer le jeu',
    del_game_msg: 'Voulez-vous vraiment supprimer le jeu <strong>{label}</strong> ?',
    del_game_done: 'Jeu supprimé',
    del_loc_title: 'Archiver le lieu',
    del_loc_msg:
      'Voulez-vous vraiment archiver le lieu <strong>{label}</strong> ? Les soirées associées sont conservées, et vous pourrez le désarchiver plus tard.',
    del_loc_done: 'Lieu archivé',
    replace_title: 'Remplacer la collection',
    replace_msg:
      'Voulez-vous vraiment <strong>remplacer toute la collection</strong> par le contenu de ce fichier ? Les images et « apporté par » saisis manuellement seront conservés.',
    replace_btn: 'Remplacer',

    saved_event: 'Soirée enregistrée',
    saved_location: 'Lieu enregistré',
    saved_game: 'Jeu mis à jour',
    saved_settings: 'Réglages enregistrés',
    unarchived: 'Lieu désarchivé',
    imported: '{count} jeux importés ✓',
    err_title_date: 'Titre et date obligatoires',
    err_name: 'Nom obligatoire',
    file_prefix: '📄 {name}',
    dash: '—',
  },

  cal: {
    dow: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
  },
};
