// GENERATED FILE — do not edit by hand.
// Regenerate after every schema change (keeps types honest against the DB):
//   supabase gen types typescript --project-id deodwnoztppvtrnehwzg > src/lib/database.types.ts
// (or via the Supabase MCP `generate_typescript_types`).

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      authors: {
        Row: {
          created_at: string
          id: string
          name: string
          note: string | null
          slug: string
          sort_name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          note?: string | null
          slug: string
          sort_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          note?: string | null
          slug?: string
          sort_name?: string | null
        }
        Relationships: []
      }
      calendar_sync: {
        Row: {
          id: boolean
          last_error: string | null
          last_error_at: string | null
          sync_token: string | null
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          id?: boolean
          last_error?: string | null
          last_error_at?: string | null
          sync_token?: string | null
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          id?: boolean
          last_error?: string | null
          last_error_at?: string | null
          sync_token?: string | null
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      constellations: {
        Row: {
          color: string
          created_at: string
          description: string | null
          id: string
          name: string
          score_url: string | null
          slug: string
          sort: number
          status: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          score_url?: string | null
          slug: string
          sort?: number
          status?: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          score_url?: string | null
          slug?: string
          sort?: number
          status?: string
        }
        Relationships: []
      }
      checkin_dreams: {
        Row: {
          checkin_id: string
          intensity: number | null
          recurring: boolean
          tone: Database["public"]["Enums"]["dream_recall"]
          woke_you: boolean
        }
        Insert: {
          checkin_id: string
          intensity?: number | null
          recurring?: boolean
          tone: Database["public"]["Enums"]["dream_recall"]
          woke_you?: boolean
        }
        Update: {
          checkin_id?: string
          intensity?: number | null
          recurring?: boolean
          tone?: Database["public"]["Enums"]["dream_recall"]
          woke_you?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "checkin_dreams_checkin_id_fkey"
            columns: ["checkin_id"]
            isOneToOne: false
            referencedRelation: "daily_checkins"
            referencedColumns: ["id"]
          },
        ]
      }
      checkin_naps: {
        Row: {
          checkin_id: string
          ended_at: string | null
          id: string
          started_at: string | null
        }
        Insert: {
          checkin_id: string
          ended_at?: string | null
          id?: string
          started_at?: string | null
        }
        Update: {
          checkin_id?: string
          ended_at?: string | null
          id?: string
          started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkin_naps_checkin_id_fkey"
            columns: ["checkin_id"]
            isOneToOne: false
            referencedRelation: "daily_checkins"
            referencedColumns: ["id"]
          },
        ]
      }
      checkin_wakings: {
        Row: {
          back_asleep_at: string | null
          checkin_id: string
          id: string
          left_bed: boolean
          woke_at: string | null
        }
        Insert: {
          back_asleep_at?: string | null
          checkin_id: string
          id?: string
          left_bed?: boolean
          woke_at?: string | null
        }
        Update: {
          back_asleep_at?: string | null
          checkin_id?: string
          id?: string
          left_bed?: boolean
          woke_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkin_wakings_checkin_id_fkey"
            columns: ["checkin_id"]
            isOneToOne: false
            referencedRelation: "daily_checkins"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_checkins: {
        Row: {
          arousal: number | null
          asleep_at: string | null
          awakenings: Database["public"]["Enums"]["awakenings"] | null
          bed_at: string | null
          created_at: string
          dream_body: string | null
          dreamless: boolean | null
          got_up_at: string | null
          id: string
          log_date: string
          note: string | null
          restedness: number | null
          skipped: boolean
          sleep_aids: Database["public"]["Enums"]["sleep_aid"][] | null
          sleep_latency: Database["public"]["Enums"]["sleep_latency"] | null
          sleep_quality: number | null
          updated_at: string
          valence: number | null
          woke_at: string | null
        }
        Insert: {
          arousal?: number | null
          asleep_at?: string | null
          awakenings?: Database["public"]["Enums"]["awakenings"] | null
          bed_at?: string | null
          created_at?: string
          dream_body?: string | null
          dreamless?: boolean | null
          got_up_at?: string | null
          id?: string
          log_date: string
          note?: string | null
          restedness?: number | null
          skipped?: boolean
          sleep_aids?: Database["public"]["Enums"]["sleep_aid"][] | null
          sleep_latency?: Database["public"]["Enums"]["sleep_latency"] | null
          sleep_quality?: number | null
          updated_at?: string
          valence?: number | null
          woke_at?: string | null
        }
        Update: {
          arousal?: number | null
          asleep_at?: string | null
          awakenings?: Database["public"]["Enums"]["awakenings"] | null
          bed_at?: string | null
          created_at?: string
          dream_body?: string | null
          dreamless?: boolean | null
          got_up_at?: string | null
          id?: string
          log_date?: string
          note?: string | null
          restedness?: number | null
          skipped?: boolean
          sleep_aids?: Database["public"]["Enums"]["sleep_aid"][] | null
          sleep_latency?: Database["public"]["Enums"]["sleep_latency"] | null
          sleep_quality?: number | null
          updated_at?: string
          valence?: number | null
          woke_at?: string | null
        }
        Relationships: []
      }
      event_people: {
        Row: {
          created_at: string
          event_id: string | null
          external_id: string | null
          person_id: string
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          external_id?: string | null
          person_id: string
        }
        Update: {
          created_at?: string
          event_id?: string | null
          external_id?: string | null
          person_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_people_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_people_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          ends_at: string | null
          id: string
          location: string | null
          notes: string | null
          starts_at: string | null
          starts_on: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          starts_at?: string | null
          starts_on: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          starts_at?: string | null
          starts_on?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      external_events: {
        Row: {
          cancelled: boolean
          ends_at: string | null
          ends_on: string | null
          event_type: string | null
          external_id: string
          id: string
          location: string | null
          series_id: string
          starts_at: string | null
          starts_on: string
          synced_at: string
          title: string | null
          url: string | null
        }
        Insert: {
          cancelled?: boolean
          ends_at?: string | null
          ends_on?: string | null
          event_type?: string | null
          external_id: string
          id?: string
          location?: string | null
          series_id: string
          starts_at?: string | null
          starts_on: string
          synced_at?: string
          title?: string | null
          url?: string | null
        }
        Update: {
          cancelled?: boolean
          ends_at?: string | null
          ends_on?: string | null
          event_type?: string | null
          external_id?: string
          id?: string
          location?: string | null
          series_id?: string
          starts_at?: string | null
          starts_on?: string
          synced_at?: string
          title?: string | null
          url?: string | null
        }
        Relationships: []
      }
      fragment_constellations: {
        Row: {
          constellation_id: string
          created_at: string
          fragment_id: string
          position: number
        }
        Insert: {
          constellation_id: string
          created_at?: string
          fragment_id: string
          position?: number
        }
        Update: {
          constellation_id?: string
          created_at?: string
          fragment_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "fragment_constellations_constellation_id_fkey"
            columns: ["constellation_id"]
            isOneToOne: false
            referencedRelation: "constellations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragment_constellations_fragment_id_fkey"
            columns: ["fragment_id"]
            isOneToOne: false
            referencedRelation: "fragments"
            referencedColumns: ["id"]
          },
        ]
      }
      fragment_subjects: {
        Row: {
          fragment_id: string
          subject_id: string
        }
        Insert: {
          fragment_id: string
          subject_id: string
        }
        Update: {
          fragment_id?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fragment_subjects_fragment_id_fkey"
            columns: ["fragment_id"]
            isOneToOne: false
            referencedRelation: "fragments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragment_subjects_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      fragment_versions: {
        Row: {
          body: string | null
          created_at: string
          excerpt: string | null
          fragment_id: string
          id: string
          kind: string
          label: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          excerpt?: string | null
          fragment_id: string
          id?: string
          kind?: string
          label?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          excerpt?: string | null
          fragment_id?: string
          id?: string
          kind?: string
          label?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fragment_versions_fragment_id_fkey"
            columns: ["fragment_id"]
            isOneToOne: false
            referencedRelation: "fragments"
            referencedColumns: ["id"]
          },
        ]
      }
      fragments: {
        Row: {
          attribution: string | null
          author_id: string | null
          body: string | null
          created_at: string
          date_precision: Database["public"]["Enums"]["date_precision"]
          deleted_at: string | null
          details: Json
          excerpt: string | null
          id: string
          is_self: boolean
          occurred_at: string
          paired_song_id: string | null
          published_at: string | null
          slug: string
          source_url: string | null
          status: Database["public"]["Enums"]["fragment_status"]
          title: string | null
          type: Database["public"]["Enums"]["fragment_type"]
          updated_at: string
          work_id: string | null
        }
        Insert: {
          attribution?: string | null
          author_id?: string | null
          body?: string | null
          created_at?: string
          date_precision?: Database["public"]["Enums"]["date_precision"]
          deleted_at?: string | null
          details?: Json
          excerpt?: string | null
          id?: string
          is_self?: boolean
          occurred_at?: string
          paired_song_id?: string | null
          published_at?: string | null
          slug: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["fragment_status"]
          title?: string | null
          type: Database["public"]["Enums"]["fragment_type"]
          updated_at?: string
          work_id?: string | null
        }
        Update: {
          attribution?: string | null
          author_id?: string | null
          body?: string | null
          created_at?: string
          date_precision?: Database["public"]["Enums"]["date_precision"]
          deleted_at?: string | null
          details?: Json
          excerpt?: string | null
          id?: string
          is_self?: boolean
          occurred_at?: string
          paired_song_id?: string | null
          published_at?: string | null
          slug?: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["fragment_status"]
          title?: string | null
          type?: Database["public"]["Enums"]["fragment_type"]
          updated_at?: string
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fragments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "authors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragments_paired_song_id_fkey"
            columns: ["paired_song_id"]
            isOneToOne: false
            referencedRelation: "fragments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragments_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          created_at: string
          horizon: Database["public"]["Enums"]["goal_horizon"]
          id: string
          name: string
          notes: string | null
          slug: string
          status: Database["public"]["Enums"]["goal_status"]
          updated_at: string
          why: string | null
        }
        Insert: {
          created_at?: string
          horizon?: Database["public"]["Enums"]["goal_horizon"]
          id?: string
          name: string
          notes?: string | null
          slug: string
          status?: Database["public"]["Enums"]["goal_status"]
          updated_at?: string
          why?: string | null
        }
        Update: {
          created_at?: string
          horizon?: Database["public"]["Enums"]["goal_horizon"]
          id?: string
          name?: string
          notes?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["goal_status"]
          updated_at?: string
          why?: string | null
        }
        Relationships: []
      }
      interaction_people: {
        Row: {
          interaction_id: string
          person_id: string
        }
        Insert: {
          interaction_id: string
          person_id: string
        }
        Update: {
          interaction_id?: string
          person_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interaction_people_interaction_id_fkey"
            columns: ["interaction_id"]
            isOneToOne: false
            referencedRelation: "interactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interaction_people_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      interactions: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["interaction_kind"]
          occurred_on: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["interaction_kind"]
          occurred_on: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["interaction_kind"]
          occurred_on?: string
          updated_at?: string
        }
        Relationships: []
      }
      pages: {
        Row: {
          content: Json
          slug: string
          updated_at: string
        }
        Insert: {
          content?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          content?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      people: {
        Row: {
          archived_at: string | null
          bio: string | null
          birth_day: number | null
          birth_month: number | null
          birth_year: number | null
          birthday_lead_days: number
          cadence_days: number
          circle: Database["public"]["Enums"]["person_circle"]
          created_at: string
          display_name: string
          drift_muted_until: string | null
          drift_mutes: number
          epithet: string | null
          full_name: string | null
          id: string
          known_since_year: number | null
          location: string | null
          photo_path: string | null
          slug: string
          sort_name: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          bio?: string | null
          birth_day?: number | null
          birth_month?: number | null
          birth_year?: number | null
          birthday_lead_days?: number
          cadence_days?: number
          circle?: Database["public"]["Enums"]["person_circle"]
          created_at?: string
          display_name: string
          drift_muted_until?: string | null
          drift_mutes?: number
          epithet?: string | null
          full_name?: string | null
          id?: string
          known_since_year?: number | null
          location?: string | null
          photo_path?: string | null
          slug: string
          sort_name?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          bio?: string | null
          birth_day?: number | null
          birth_month?: number | null
          birth_year?: number | null
          birthday_lead_days?: number
          cadence_days?: number
          circle?: Database["public"]["Enums"]["person_circle"]
          created_at?: string
          display_name?: string
          drift_muted_until?: string | null
          drift_mutes?: number
          epithet?: string | null
          full_name?: string | null
          id?: string
          known_since_year?: number | null
          location?: string | null
          photo_path?: string | null
          slug?: string
          sort_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      person_fragments: {
        Row: {
          created_at: string
          fragment_id: string
          note: string | null
          person_id: string
        }
        Insert: {
          created_at?: string
          fragment_id: string
          note?: string | null
          person_id: string
        }
        Update: {
          created_at?: string
          fragment_id?: string
          note?: string | null
          person_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_fragments_fragment_id_fkey"
            columns: ["fragment_id"]
            isOneToOne: false
            referencedRelation: "fragments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_fragments_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      person_works: {
        Row: {
          created_at: string
          note: string | null
          person_id: string
          work_id: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          person_id: string
          work_id: string
        }
        Update: {
          created_at?: string
          note?: string | null
          person_id?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_works_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_works_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      push_day_claims: {
        Row: {
          delivered: number
          sent_at: string
          ymd: string
        }
        Insert: {
          delivered?: number
          sent_at?: string
          ymd: string
        }
        Update: {
          delivered?: number
          sent_at?: string
          ymd?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          last_seen_at: string
          p256dh: string
          user_agent: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          last_seen_at?: string
          p256dh: string
          user_agent?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          last_seen_at?: string
          p256dh?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      settings: {
        Row: {
          created_at: string
          home_timezone: string
          id: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          home_timezone?: string
          id?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          home_timezone?: string
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      subjects: {
        Row: {
          created_at: string
          definition: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          definition?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          definition?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      task_events: {
        Row: {
          created_at: string
          for_due_on: string | null
          id: string
          occurred_on: string
          outcome: Database["public"]["Enums"]["task_outcome"]
          task_id: string
        }
        Insert: {
          created_at?: string
          for_due_on?: string | null
          id?: string
          occurred_on: string
          outcome: Database["public"]["Enums"]["task_outcome"]
          task_id: string
        }
        Update: {
          created_at?: string
          for_due_on?: string | null
          id?: string
          occurred_on?: string
          outcome?: Database["public"]["Enums"]["task_outcome"]
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          archived_at: string | null
          created_at: string
          due_on: string | null
          due_time: string | null
          effort: Database["public"]["Enums"]["task_effort"]
          goal_id: string | null
          id: string
          lead_days: number | null
          notes: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          recur_every: number | null
          recur_mode: Database["public"]["Enums"]["recurrence_mode"] | null
          recur_rrule: string | null
          recur_unit: Database["public"]["Enums"]["recurrence_unit"] | null
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          due_on?: string | null
          due_time?: string | null
          effort?: Database["public"]["Enums"]["task_effort"]
          goal_id?: string | null
          id?: string
          lead_days?: number | null
          notes?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recur_every?: number | null
          recur_mode?: Database["public"]["Enums"]["recurrence_mode"] | null
          recur_rrule?: string | null
          recur_unit?: Database["public"]["Enums"]["recurrence_unit"] | null
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          due_on?: string | null
          due_time?: string | null
          effort?: Database["public"]["Enums"]["task_effort"]
          goal_id?: string | null
          id?: string
          lead_days?: number | null
          notes?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recur_every?: number | null
          recur_mode?: Database["public"]["Enums"]["recurrence_mode"] | null
          recur_rrule?: string | null
          recur_unit?: Database["public"]["Enums"]["recurrence_unit"] | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      works: {
        Row: {
          author_id: string | null
          created_at: string
          id: string
          kind: string | null
          slug: string
          title: string
          year: number | null
        }
        Insert: {
          author_id?: string | null
          created_at?: string
          id?: string
          kind?: string | null
          slug: string
          title: string
          year?: number | null
        }
        Update: {
          author_id?: string | null
          created_at?: string
          id?: string
          kind?: string | null
          slug?: string
          title?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "works_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "authors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      goal_last_done: {
        Row: {
          done_total: number | null
          goal_id: string | null
          last_done_on: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      person_last_contact: {
        Row: {
          interaction_count: number | null
          last_contact_on: string | null
          person_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interaction_people_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
      merge_authors: { Args: { from_id: string; into_id: string }; Returns: undefined }
      merge_subjects: { Args: { from_id: string; into_id: string }; Returns: undefined }
      merge_works: { Args: { from_id: string; into_id: string }; Returns: undefined }
    }
    Enums: {
      awakenings: "none" | "few" | "many"
      date_precision: "day" | "year"
      dream_recall: "none" | "neutral" | "anxious" | "distressing"
      fragment_status: "note" | "draft" | "published"
      fragment_type: "writing" | "quote" | "song"
      goal_horizon: "this_season" | "this_year" | "next_few_years"
      goal_status: "active" | "paused" | "achieved" | "let_go"
      interaction_kind:
        | "hangout"
        | "call"
        | "message"
        | "gift"
        | "shared"
        | "note"
      person_circle: "family" | "friends" | "professional"
      recurrence_mode: "after_completion" | "fixed"
      recurrence_unit: "days" | "weeks" | "months"
      sleep_aid:
        | "melatonin"
        | "antihistamine"
        | "prescription"
        | "cannabis"
        | "alcohol"
        | "other"
      sleep_latency: "under_15" | "15_30" | "30_60" | "over_60"
      task_effort: "quick" | "sitting" | "block" | "project"
      task_outcome: "done" | "skipped"
      task_priority: "low" | "normal" | "high"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      awakenings: ["none", "few", "many"],
      date_precision: ["day", "year"],
      dream_recall: ["none", "neutral", "anxious", "distressing"],
      fragment_status: ["note", "draft", "published"],
      fragment_type: ["writing", "quote", "song"],
      goal_horizon: ["this_season", "this_year", "next_few_years"],
      goal_status: ["active", "paused", "achieved", "let_go"],
      interaction_kind: [
        "hangout",
        "call",
        "message",
        "gift",
        "shared",
        "note",
      ],
      person_circle: ["family", "friends", "professional"],
      recurrence_mode: ["after_completion", "fixed"],
      recurrence_unit: ["days", "weeks", "months"],
      sleep_aid: [
        "melatonin",
        "antihistamine",
        "prescription",
        "cannabis",
        "alcohol",
        "other",
      ],
      sleep_latency: ["under_15", "15_30", "30_60", "over_60"],
      task_effort: ["quick", "sitting", "block", "project"],
      task_outcome: ["done", "skipped"],
      task_priority: ["low", "normal", "high"],
    },
  },
} as const
