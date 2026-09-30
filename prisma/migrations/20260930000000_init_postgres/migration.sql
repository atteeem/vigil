-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT,
    "telegram_handle" TEXT,
    "country" TEXT,
    "region" TEXT,
    "language" TEXT,
    "source_category" TEXT,
    "reliability_tier" TEXT,
    "source_role" TEXT,
    "canonical_source_url" TEXT,
    "feed_url" TEXT,
    "social_profile_url" TEXT,
    "platform" TEXT,
    "platform_handle" TEXT,
    "verification_status" TEXT NOT NULL DEFAULT 'needs_verification',
    "verified_at" TIMESTAMP(3),
    "verification_notes" TEXT,
    "independence_class" TEXT,
    "claim_policy" TEXT,
    "perspective" TEXT,
    "permission_status" TEXT NOT NULL DEFAULT 'unauthorized',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "auto_ingest" BOOLEAN NOT NULL DEFAULT false,
    "auto_processing" BOOLEAN NOT NULL DEFAULT true,
    "poll_interval_minutes" INTEGER NOT NULL DEFAULT 5,
    "next_poll_at" TIMESTAMP(3),
    "last_attempted_at" TIMESTAMP(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_successful_ingestion" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_logs" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "new_count" INTEGER NOT NULL DEFAULT 0,
    "already_known" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_message" TEXT,

    CONSTRAINT "ingestion_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_ingestion_items" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "original_url" TEXT,
    "original_url_key" TEXT,
    "original_title" TEXT,
    "original_text" TEXT,
    "language" TEXT,
    "published_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "media_urls" TEXT,
    "processing_status" TEXT NOT NULL DEFAULT 'pending',
    "raw_metadata" TEXT,
    "suggested_event_type" TEXT,
    "suggested_conflict_id" TEXT,
    "suggested_region" TEXT,
    "suggested_country_code" TEXT,
    "suggested_location_name" TEXT,
    "suggested_lat" DOUBLE PRECISION,
    "suggested_lng" DOUBLE PRECISION,
    "suggested_severity" TEXT,
    "suggested_importance" INTEGER,
    "location_source" TEXT,
    "processed_at" TIMESTAMP(3),
    "suggested_classification" TEXT,
    "suggested_readiness" TEXT,
    "suggested_readiness_reasons" TEXT,
    "suggested_conflict_confidence" DOUBLE PRECISION,
    "suggested_conflict_reasons" TEXT,

    CONSTRAINT "raw_ingestion_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_facts" (
    "id" TEXT NOT NULL,
    "raw_ingestion_item_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'extracted',
    "original_value" TEXT,
    "extracted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extracted_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflicts" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "region" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "severity" TEXT NOT NULL,
    "intensity" INTEGER NOT NULL,
    "intensity_change_24h" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "primary_effects" TEXT,
    "countries" TEXT,
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "full_scale_war" BOOLEAN NOT NULL DEFAULT false,
    "fighting_countries" TEXT,
    "participant_countries" TEXT,
    "supporter_countries" TEXT,
    "regions" TEXT,
    "geography_basis" TEXT NOT NULL DEFAULT 'admin',
    "classification_confidence" TEXT NOT NULL DEFAULT 'established',
    "classification_note" TEXT,
    "family_id" TEXT,
    "curated_at" TIMESTAMP(3),

    CONSTRAINT "conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflict_families" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conflict_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflict_participants" (
    "id" TEXT NOT NULL,
    "conflict_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'belligerent',
    "note" TEXT,
    "source_name" TEXT,
    "source_url" TEXT,
    "observed_at" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conflict_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflict_metadata_sources" (
    "id" TEXT NOT NULL,
    "conflict_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "source_url" TEXT,
    "note" TEXT,
    "retrieved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conflict_metadata_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_conflict_links" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "conflict_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'dedicated',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_conflict_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_candidates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "conflict_id" TEXT,
    "source_type" TEXT NOT NULL DEFAULT 'news',
    "language" TEXT,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflict_actors" (
    "id" TEXT NOT NULL,
    "conflict_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conflict_actors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflict_territories" (
    "id" TEXT NOT NULL,
    "conflict_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "status" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "geometry" TEXT NOT NULL,
    "source_name" TEXT,
    "source_url" TEXT,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_to" TIMESTAMP(3),
    "published" BOOLEAN NOT NULL DEFAULT false,
    "split_from_id" TEXT,
    "territory_kind" TEXT NOT NULL DEFAULT 'control',
    "dataset_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conflict_territories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'conflict_news',
    "location_name" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "country_code" TEXT,
    "region" TEXT,
    "location_scope" TEXT,
    "admin_region" TEXT,
    "city" TEXT,
    "location_evidence" TEXT,
    "conflict_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "severity" TEXT NOT NULL,
    "importance" INTEGER NOT NULL DEFAULT 50,
    "verification_status" TEXT NOT NULL DEFAULT 'unverified',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "actors" TEXT,
    "casualties_killed" INTEGER,
    "casualties_injured" INTEGER,
    "infrastructure_damage" TEXT,
    "location_precision" TEXT,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_update_proposals" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "raw_ingestion_item_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "current_value" TEXT,
    "proposed_value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "change_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "event_update_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_history" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT NOT NULL,
    "raw_ingestion_item_id" TEXT,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_sources" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "raw_ingestion_item_id" TEXT NOT NULL,
    "relationship" TEXT NOT NULL DEFAULT 'originating',
    "is_originating_source" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "military_units" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branch" TEXT,
    "unit_type" TEXT,
    "parent_unit_id" TEXT,
    "status" TEXT,
    "entity_type" TEXT,
    "country" TEXT,
    "native_name" TEXT,
    "primary_conflict_id" TEXT,
    "source_name" TEXT,
    "source_url" TEXT,
    "last_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "military_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "military_equipment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "country_of_origin" TEXT,
    "source_name" TEXT,
    "source_url" TEXT,
    "last_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "military_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commanders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" TEXT,
    "current_unit_id" TEXT,
    "source_name" TEXT,
    "source_url" TEXT,
    "last_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commanders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commander_appointments" (
    "id" TEXT NOT NULL,
    "commander_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "role" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "source_name" TEXT,
    "source_url" TEXT,
    "observed_at" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "last_confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commander_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "military_unit_equipment" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "source_name" TEXT,
    "source_url" TEXT,
    "observed_at" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "military_unit_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_military_unit_links" (
    "id" TEXT NOT NULL,
    "raw_ingestion_item_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "matched_text" TEXT,
    "method" TEXT,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_military_unit_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_military_equipment_links" (
    "id" TEXT NOT NULL,
    "raw_ingestion_item_id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "matched_text" TEXT,
    "method" TEXT,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_military_equipment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_military_commander_links" (
    "id" TEXT NOT NULL,
    "raw_ingestion_item_id" TEXT NOT NULL,
    "commander_id" TEXT NOT NULL,
    "matched_text" TEXT,
    "method" TEXT,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_military_commander_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "military_unit_events" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "source_name" TEXT,
    "source_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "military_unit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas_of_operation" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "conflict_id" TEXT,
    "name" TEXT,
    "description" TEXT,
    "geometry" TEXT NOT NULL,
    "precision" TEXT NOT NULL DEFAULT 'unknown',
    "as_of_date" TIMESTAMP(3),
    "source_name" TEXT,
    "source_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "areas_of_operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "territorial_change_candidates" (
    "id" TEXT NOT NULL,
    "conflict_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "claimed_actor_id" TEXT,
    "previous_actor_id" TEXT,
    "location_name" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "precision" TEXT NOT NULL DEFAULT 'unknown',
    "source_name" TEXT,
    "source_url" TEXT,
    "observed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "review_note" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "change_type" TEXT NOT NULL DEFAULT 'captured',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "evidence" TEXT,
    "claim_key" TEXT,
    "raw_ingestion_item_id" TEXT,
    "corroboration" TEXT,
    "merged_into_id" TEXT,
    "applied_territory_id" TEXT,
    "geometry_pending" BOOLEAN NOT NULL DEFAULT false,
    "source_role" TEXT,

    CONSTRAINT "territorial_change_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_aliases" (
    "id" TEXT NOT NULL,
    "entity_kind" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "alias_type" TEXT NOT NULL DEFAULT 'alternate',
    "source_scope" TEXT,
    "country_scope" TEXT,
    "source_name" TEXT,
    "source_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_parent_history" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "parent_unit_id" TEXT,
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "source_name" TEXT,
    "source_url" TEXT,
    "observed_at" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_parent_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actor_relationships" (
    "id" TEXT NOT NULL,
    "from_id" TEXT NOT NULL,
    "to_id" TEXT NOT NULL,
    "relation_type" TEXT NOT NULL,
    "conflict_id" TEXT,
    "source_name" TEXT,
    "source_url" TEXT,
    "observed_at" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actor_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_equipment_links" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "matched_text" TEXT,
    "confidence" DOUBLE PRECISION,
    "source_name" TEXT,
    "source_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_equipment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_commander_links" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "commander_id" TEXT NOT NULL,
    "matched_text" TEXT,
    "confidence" DOUBLE PRECISION,
    "source_name" TEXT,
    "source_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_commander_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_match_reviews" (
    "id" TEXT NOT NULL,
    "raw_ingestion_item_id" TEXT NOT NULL,
    "entity_kind" TEXT NOT NULL,
    "matched_text" TEXT NOT NULL,
    "candidate_ids" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolved_entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "entity_match_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_events" (
    "id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "subtype" TEXT,
    "status" TEXT,
    "entity_key" TEXT,
    "country_code" TEXT,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "source_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity_domain" TEXT,
    "severity_value" DOUBLE PRECISION,
    "severity_label" TEXT,
    "prominence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence_label" TEXT,
    "confidence_value" DOUBLE PRECISION,
    "geometry_type" TEXT NOT NULL DEFAULT 'point',
    "geometry" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "min_lat" DOUBLE PRECISION NOT NULL,
    "max_lat" DOUBLE PRECISION NOT NULL,
    "min_lng" DOUBLE PRECISION NOT NULL,
    "max_lng" DOUBLE PRECISION NOT NULL,
    "location_precision" TEXT NOT NULL DEFAULT 'exact',
    "observed_at" TIMESTAMP(3) NOT NULL,
    "provider_updated_at" TIMESTAMP(3),
    "effective_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "source_url" TEXT,
    "metadata" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "content_hash" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_event_revisions" (
    "id" TEXT NOT NULL,
    "global_event_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "provider_updated_at" TIMESTAMP(3),
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" TEXT NOT NULL,

    CONSTRAINT "global_event_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_event_aggregates" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "cell_lat" DOUBLE PRECISION NOT NULL,
    "cell_lng" DOUBLE PRECISION NOT NULL,
    "count" INTEGER NOT NULL,
    "max_intensity" DOUBLE PRECISION,
    "sum_intensity" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_event_aggregates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hazard_zones" (
    "id" TEXT NOT NULL,
    "geometry" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hazard_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_event_links" (
    "id" TEXT NOT NULL,
    "global_event_id" TEXT NOT NULL,
    "conflict_id" TEXT,
    "event_id" TEXT,
    "basis" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "note" TEXT,
    "source_name" TEXT,
    "source_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "global_event_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_event_claims" (
    "id" TEXT NOT NULL,
    "global_event_id" TEXT,
    "entity_key" TEXT,
    "claimant" TEXT NOT NULL,
    "claim_type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source_name" TEXT,
    "source_url" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verification" TEXT NOT NULL DEFAULT 'unverified',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_event_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchers" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "settings" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "watchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watches" (
    "id" TEXT NOT NULL,
    "watcher_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'major',
    "rules" TEXT NOT NULL DEFAULT '{}',
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "paused_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "watcher_id" TEXT NOT NULL,
    "watch_id" TEXT,
    "fingerprint" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "priority_score" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_key" TEXT NOT NULL,
    "entity_label" TEXT NOT NULL,
    "event_id" TEXT,
    "global_event_id" TEXT,
    "conflict_slug" TEXT,
    "deep_link" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "is_party_claim" BOOLEAN NOT NULL DEFAULT false,
    "is_resolution" BOOLEAN NOT NULL DEFAULT false,
    "suppressed_count" INTEGER NOT NULL DEFAULT 0,
    "quiet" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_states" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "data" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_records" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signal_kind" TEXT NOT NULL,
    "signal_ref" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_key" TEXT NOT NULL,
    "watch_id" TEXT,
    "watcher_id" TEXT,
    "decision" TEXT NOT NULL,
    "rule" TEXT,
    "priority" TEXT,
    "reason" TEXT,
    "notification_id" TEXT,
    "detail" TEXT,

    CONSTRAINT "alert_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "state_transitions" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT NOT NULL,
    "from_value" DOUBLE PRECISION,
    "to_value" DOUBLE PRECISION,
    "material" BOOLEAN NOT NULL DEFAULT false,
    "data" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "state_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brief_snapshots" (
    "id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "window_key" TEXT NOT NULL,
    "from_at" TIMESTAMP(3) NOT NULL,
    "to_at" TIMESTAMP(3) NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision" TEXT NOT NULL,
    "watcher_id" TEXT,
    "development_ids" TEXT NOT NULL,
    "summary" TEXT NOT NULL,

    CONSTRAINT "brief_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "territorial_datasets" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "conflict_id" TEXT,
    "region_id" TEXT,
    "country_codes" TEXT,
    "dataset_type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "source_url" TEXT,
    "license" TEXT,
    "attribution" TEXT,
    "coverage_description" TEXT,
    "last_updated" TIMESTAMP(3),
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "geometry_availability" TEXT NOT NULL DEFAULT 'none',
    "actor_coverage" TEXT,
    "confidence" DOUBLE PRECISION,
    "review_status" TEXT NOT NULL DEFAULT 'candidate',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "territorial_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingestion_logs_source_id_attempted_at_idx" ON "ingestion_logs"("source_id", "attempted_at");

-- CreateIndex
CREATE INDEX "raw_ingestion_items_source_id_original_url_key_idx" ON "raw_ingestion_items"("source_id", "original_url_key");

-- CreateIndex
CREATE INDEX "raw_ingestion_items_processing_status_suggested_readiness_s_idx" ON "raw_ingestion_items"("processing_status", "suggested_readiness", "suggested_classification");

-- CreateIndex
CREATE UNIQUE INDEX "raw_ingestion_items_source_id_external_id_key" ON "raw_ingestion_items"("source_id", "external_id");

-- CreateIndex
CREATE INDEX "extracted_facts_raw_ingestion_item_id_field_idx" ON "extracted_facts"("raw_ingestion_item_id", "field");

-- CreateIndex
CREATE UNIQUE INDEX "conflicts_slug_key" ON "conflicts"("slug");

-- CreateIndex
CREATE INDEX "conflicts_family_id_idx" ON "conflicts"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "conflict_families_slug_key" ON "conflict_families"("slug");

-- CreateIndex
CREATE INDEX "conflict_participants_unit_id_idx" ON "conflict_participants"("unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "conflict_participants_conflict_id_unit_id_key" ON "conflict_participants"("conflict_id", "unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "conflict_metadata_sources_conflict_id_field_source_name_key" ON "conflict_metadata_sources"("conflict_id", "field", "source_name");

-- CreateIndex
CREATE INDEX "source_conflict_links_conflict_id_idx" ON "source_conflict_links"("conflict_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_conflict_links_source_id_conflict_id_key" ON "source_conflict_links"("source_id", "conflict_id");

-- CreateIndex
CREATE INDEX "source_candidates_conflict_id_status_idx" ON "source_candidates"("conflict_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "conflict_actors_conflict_id_name_key" ON "conflict_actors"("conflict_id", "name");

-- CreateIndex
CREATE INDEX "conflict_territories_dataset_id_idx" ON "conflict_territories"("dataset_id");

-- CreateIndex
CREATE INDEX "conflict_territories_conflict_id_valid_from_idx" ON "conflict_territories"("conflict_id", "valid_from");

-- CreateIndex
CREATE INDEX "conflict_territories_published_valid_from_valid_to_idx" ON "conflict_territories"("published", "valid_from", "valid_to");

-- CreateIndex
CREATE INDEX "conflict_territories_split_from_id_idx" ON "conflict_territories"("split_from_id");

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE INDEX "event_update_proposals_event_id_status_idx" ON "event_update_proposals"("event_id", "status");

-- CreateIndex
CREATE INDEX "event_history_event_id_created_at_idx" ON "event_history"("event_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_sources_event_id_raw_ingestion_item_id_key" ON "event_sources"("event_id", "raw_ingestion_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "military_units_name_key" ON "military_units"("name");

-- CreateIndex
CREATE INDEX "military_units_entity_type_idx" ON "military_units"("entity_type");

-- CreateIndex
CREATE INDEX "military_units_country_idx" ON "military_units"("country");

-- CreateIndex
CREATE UNIQUE INDEX "military_equipment_name_key" ON "military_equipment"("name");

-- CreateIndex
CREATE UNIQUE INDEX "commanders_name_key" ON "commanders"("name");

-- CreateIndex
CREATE INDEX "commander_appointments_commander_id_idx" ON "commander_appointments"("commander_id");

-- CreateIndex
CREATE INDEX "commander_appointments_unit_id_idx" ON "commander_appointments"("unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "military_unit_equipment_unit_id_equipment_id_key" ON "military_unit_equipment"("unit_id", "equipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "article_military_unit_links_raw_ingestion_item_id_unit_id_key" ON "article_military_unit_links"("raw_ingestion_item_id", "unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "article_military_equipment_links_raw_ingestion_item_id_equi_key" ON "article_military_equipment_links"("raw_ingestion_item_id", "equipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "article_military_commander_links_raw_ingestion_item_id_comm_key" ON "article_military_commander_links"("raw_ingestion_item_id", "commander_id");

-- CreateIndex
CREATE UNIQUE INDEX "military_unit_events_unit_id_event_id_key" ON "military_unit_events"("unit_id", "event_id");

-- CreateIndex
CREATE INDEX "areas_of_operation_unit_id_idx" ON "areas_of_operation"("unit_id");

-- CreateIndex
CREATE INDEX "areas_of_operation_conflict_id_idx" ON "areas_of_operation"("conflict_id");

-- CreateIndex
CREATE INDEX "territorial_change_candidates_conflict_id_status_idx" ON "territorial_change_candidates"("conflict_id", "status");

-- CreateIndex
CREATE INDEX "territorial_change_candidates_claim_key_idx" ON "territorial_change_candidates"("claim_key");

-- CreateIndex
CREATE INDEX "entity_aliases_entity_kind_normalized_idx" ON "entity_aliases"("entity_kind", "normalized");

-- CreateIndex
CREATE UNIQUE INDEX "entity_aliases_entity_kind_entity_id_normalized_key" ON "entity_aliases"("entity_kind", "entity_id", "normalized");

-- CreateIndex
CREATE INDEX "unit_parent_history_unit_id_idx" ON "unit_parent_history"("unit_id");

-- CreateIndex
CREATE INDEX "actor_relationships_to_id_idx" ON "actor_relationships"("to_id");

-- CreateIndex
CREATE UNIQUE INDEX "actor_relationships_from_id_to_id_relation_type_conflict_id_key" ON "actor_relationships"("from_id", "to_id", "relation_type", "conflict_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_equipment_links_event_id_equipment_id_key" ON "event_equipment_links"("event_id", "equipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_commander_links_event_id_commander_id_key" ON "event_commander_links"("event_id", "commander_id");

-- CreateIndex
CREATE INDEX "entity_match_reviews_status_idx" ON "entity_match_reviews"("status");

-- CreateIndex
CREATE UNIQUE INDEX "entity_match_reviews_raw_ingestion_item_id_entity_kind_matc_key" ON "entity_match_reviews"("raw_ingestion_item_id", "entity_kind", "matched_text");

-- CreateIndex
CREATE INDEX "global_events_layer_entity_key_idx" ON "global_events"("layer", "entity_key");

-- CreateIndex
CREATE INDEX "global_events_layer_observed_at_idx" ON "global_events"("layer", "observed_at");

-- CreateIndex
CREATE INDEX "global_events_category_observed_at_idx" ON "global_events"("category", "observed_at");

-- CreateIndex
CREATE INDEX "global_events_layer_min_lat_max_lat_min_lng_max_lng_idx" ON "global_events"("layer", "min_lat", "max_lat", "min_lng", "max_lng");

-- CreateIndex
CREATE INDEX "global_events_expires_at_idx" ON "global_events"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "global_events_provider_provider_event_id_key" ON "global_events"("provider", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "global_event_revisions_global_event_id_revision_key" ON "global_event_revisions"("global_event_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "global_event_aggregates_provider_category_day_cell_lat_cell_key" ON "global_event_aggregates"("provider", "category", "day", "cell_lat", "cell_lng");

-- CreateIndex
CREATE INDEX "global_event_links_global_event_id_idx" ON "global_event_links"("global_event_id");

-- CreateIndex
CREATE INDEX "global_event_links_conflict_id_idx" ON "global_event_links"("conflict_id");

-- CreateIndex
CREATE INDEX "global_event_claims_global_event_id_idx" ON "global_event_claims"("global_event_id");

-- CreateIndex
CREATE INDEX "watches_entity_type_entity_key_idx" ON "watches"("entity_type", "entity_key");

-- CreateIndex
CREATE UNIQUE INDEX "watches_watcher_id_entity_type_entity_key_key" ON "watches"("watcher_id", "entity_type", "entity_key");

-- CreateIndex
CREATE INDEX "notifications_watcher_id_created_at_idx" ON "notifications"("watcher_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_watcher_id_read_at_idx" ON "notifications"("watcher_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_watcher_id_fingerprint_key" ON "notifications"("watcher_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "alert_states_kind_key_alert_type_key" ON "alert_states"("kind", "key", "alert_type");

-- CreateIndex
CREATE INDEX "alert_records_created_at_idx" ON "alert_records"("created_at");

-- CreateIndex
CREATE INDEX "alert_records_fingerprint_idx" ON "alert_records"("fingerprint");

-- CreateIndex
CREATE INDEX "state_transitions_at_idx" ON "state_transitions"("at");

-- CreateIndex
CREATE INDEX "state_transitions_kind_key_at_idx" ON "state_transitions"("kind", "key", "at");

-- CreateIndex
CREATE INDEX "brief_snapshots_scope_key_generated_at_idx" ON "brief_snapshots"("scope_key", "generated_at");

-- CreateIndex
CREATE UNIQUE INDEX "territorial_datasets_slug_key" ON "territorial_datasets"("slug");

-- CreateIndex
CREATE INDEX "territorial_datasets_conflict_id_idx" ON "territorial_datasets"("conflict_id");

-- AddForeignKey
ALTER TABLE "ingestion_logs" ADD CONSTRAINT "ingestion_logs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_ingestion_items" ADD CONSTRAINT "raw_ingestion_items_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_facts" ADD CONSTRAINT "extracted_facts_raw_ingestion_item_id_fkey" FOREIGN KEY ("raw_ingestion_item_id") REFERENCES "raw_ingestion_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "conflict_families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_participants" ADD CONSTRAINT "conflict_participants_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_participants" ADD CONSTRAINT "conflict_participants_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "military_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_metadata_sources" ADD CONSTRAINT "conflict_metadata_sources_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_conflict_links" ADD CONSTRAINT "source_conflict_links_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_conflict_links" ADD CONSTRAINT "source_conflict_links_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_candidates" ADD CONSTRAINT "source_candidates_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_actors" ADD CONSTRAINT "conflict_actors_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_territories" ADD CONSTRAINT "conflict_territories_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_territories" ADD CONSTRAINT "conflict_territories_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "conflict_actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_territories" ADD CONSTRAINT "conflict_territories_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "territorial_datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_update_proposals" ADD CONSTRAINT "event_update_proposals_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_update_proposals" ADD CONSTRAINT "event_update_proposals_raw_ingestion_item_id_fkey" FOREIGN KEY ("raw_ingestion_item_id") REFERENCES "raw_ingestion_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_history" ADD CONSTRAINT "event_history_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_history" ADD CONSTRAINT "event_history_raw_ingestion_item_id_fkey" FOREIGN KEY ("raw_ingestion_item_id") REFERENCES "raw_ingestion_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_raw_ingestion_item_id_fkey" FOREIGN KEY ("raw_ingestion_item_id") REFERENCES "raw_ingestion_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "military_units" ADD CONSTRAINT "military_units_parent_unit_id_fkey" FOREIGN KEY ("parent_unit_id") REFERENCES "military_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "military_units" ADD CONSTRAINT "military_units_primary_conflict_id_fkey" FOREIGN KEY ("primary_conflict_id") REFERENCES "conflicts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commanders" ADD CONSTRAINT "commanders_current_unit_id_fkey" FOREIGN KEY ("current_unit_id") REFERENCES "military_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commander_appointments" ADD CONSTRAINT "commander_appointments_commander_id_fkey" FOREIGN KEY ("commander_id") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commander_appointments" ADD CONSTRAINT "commander_appointments_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "military_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "military_unit_equipment" ADD CONSTRAINT "military_unit_equipment_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "military_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "military_unit_equipment" ADD CONSTRAINT "military_unit_equipment_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "military_equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_military_unit_links" ADD CONSTRAINT "article_military_unit_links_raw_ingestion_item_id_fkey" FOREIGN KEY ("raw_ingestion_item_id") REFERENCES "raw_ingestion_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_military_unit_links" ADD CONSTRAINT "article_military_unit_links_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "military_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_military_equipment_links" ADD CONSTRAINT "article_military_equipment_links_raw_ingestion_item_id_fkey" FOREIGN KEY ("raw_ingestion_item_id") REFERENCES "raw_ingestion_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_military_equipment_links" ADD CONSTRAINT "article_military_equipment_links_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "military_equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_military_commander_links" ADD CONSTRAINT "article_military_commander_links_raw_ingestion_item_id_fkey" FOREIGN KEY ("raw_ingestion_item_id") REFERENCES "raw_ingestion_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_military_commander_links" ADD CONSTRAINT "article_military_commander_links_commander_id_fkey" FOREIGN KEY ("commander_id") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "military_unit_events" ADD CONSTRAINT "military_unit_events_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "military_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "military_unit_events" ADD CONSTRAINT "military_unit_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas_of_operation" ADD CONSTRAINT "areas_of_operation_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "military_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas_of_operation" ADD CONSTRAINT "areas_of_operation_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territorial_change_candidates" ADD CONSTRAINT "territorial_change_candidates_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territorial_change_candidates" ADD CONSTRAINT "territorial_change_candidates_claimed_actor_id_fkey" FOREIGN KEY ("claimed_actor_id") REFERENCES "military_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territorial_change_candidates" ADD CONSTRAINT "territorial_change_candidates_previous_actor_id_fkey" FOREIGN KEY ("previous_actor_id") REFERENCES "military_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_parent_history" ADD CONSTRAINT "unit_parent_history_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "military_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_parent_history" ADD CONSTRAINT "unit_parent_history_parent_unit_id_fkey" FOREIGN KEY ("parent_unit_id") REFERENCES "military_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actor_relationships" ADD CONSTRAINT "actor_relationships_from_id_fkey" FOREIGN KEY ("from_id") REFERENCES "military_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actor_relationships" ADD CONSTRAINT "actor_relationships_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "military_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_equipment_links" ADD CONSTRAINT "event_equipment_links_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_equipment_links" ADD CONSTRAINT "event_equipment_links_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "military_equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_commander_links" ADD CONSTRAINT "event_commander_links_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_commander_links" ADD CONSTRAINT "event_commander_links_commander_id_fkey" FOREIGN KEY ("commander_id") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_match_reviews" ADD CONSTRAINT "entity_match_reviews_raw_ingestion_item_id_fkey" FOREIGN KEY ("raw_ingestion_item_id") REFERENCES "raw_ingestion_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_events" ADD CONSTRAINT "global_events_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_event_revisions" ADD CONSTRAINT "global_event_revisions_global_event_id_fkey" FOREIGN KEY ("global_event_id") REFERENCES "global_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_event_links" ADD CONSTRAINT "global_event_links_global_event_id_fkey" FOREIGN KEY ("global_event_id") REFERENCES "global_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_event_claims" ADD CONSTRAINT "global_event_claims_global_event_id_fkey" FOREIGN KEY ("global_event_id") REFERENCES "global_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watches" ADD CONSTRAINT "watches_watcher_id_fkey" FOREIGN KEY ("watcher_id") REFERENCES "watchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_watcher_id_fkey" FOREIGN KEY ("watcher_id") REFERENCES "watchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territorial_datasets" ADD CONSTRAINT "territorial_datasets_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
