// Gerado por `pnpm db:types` (supabase gen types typescript --local). Não editar à mão —
// regenerar após qualquer migration em supabase/migrations.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activation_metrics: {
        Row: {
          activations: number
          day: string
          platform_id: string
          store_id: number
        }
        Insert: {
          activations?: number
          day?: string
          platform_id: string
          store_id: number
        }
        Update: {
          activations?: number
          day?: string
          platform_id?: string
          store_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "activation_metrics_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activation_metrics_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      crawl_state: {
        Row: {
          last_checked_at: string | null
          last_outcome: string | null
          platform_id: string
          slug: string
          store_id: number | null
          tier: string
        }
        Insert: {
          last_checked_at?: string | null
          last_outcome?: string | null
          platform_id: string
          slug: string
          store_id?: number | null
          tier?: string
        }
        Update: {
          last_checked_at?: string | null
          last_outcome?: string | null
          platform_id?: string
          slug?: string
          store_id?: number | null
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "crawl_state_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crawl_state_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_history: {
        Row: {
          changed_at: string
          id: number
          is_upto: boolean | null
          platform_id: string | null
          reward_type: string
          store_id: number
          value: number | null
          value_partial: number | null
        }
        Insert: {
          changed_at?: string
          id?: never
          is_upto?: boolean | null
          platform_id?: string | null
          reward_type: string
          store_id: number
          value?: number | null
          value_partial?: number | null
        }
        Update: {
          changed_at?: string
          id?: never
          is_upto?: boolean | null
          platform_id?: string | null
          reward_type?: string
          store_id?: number
          value?: number | null
          value_partial?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "offer_history_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_history_store_id_platform_id_fkey"
            columns: ["store_id", "platform_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["store_id", "platform_id"]
          },
        ]
      }
      offers: {
        Row: {
          active: boolean | null
          is_upto: boolean | null
          last_seen_at: string
          platform_id: string
          previous_raw_text: string | null
          previous_reward_type: string | null
          previous_value: number | null
          raw_text: string
          reward_type: string
          store_id: number
          updated_at: string | null
          url: string
          value: number
          value_partial: number | null
        }
        Insert: {
          active?: boolean | null
          is_upto?: boolean | null
          last_seen_at: string
          platform_id: string
          previous_raw_text?: string | null
          previous_reward_type?: string | null
          previous_value?: number | null
          raw_text: string
          reward_type: string
          store_id: number
          updated_at?: string | null
          url: string
          value: number
          value_partial?: number | null
        }
        Update: {
          active?: boolean | null
          is_upto?: boolean | null
          last_seen_at?: string
          platform_id?: string
          previous_raw_text?: string | null
          previous_reward_type?: string | null
          previous_value?: number | null
          raw_text?: string
          reward_type?: string
          store_id?: number
          updated_at?: string | null
          url?: string
          value?: number
          value_partial?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "offers_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      platforms: {
        Row: {
          base_url: string
          id: string
          name: string
          throttle_multiplier: number
        }
        Insert: {
          base_url: string
          id: string
          name: string
          throttle_multiplier?: number
        }
        Update: {
          base_url?: string
          id?: string
          name?: string
          throttle_multiplier?: number
        }
        Relationships: []
      }
      scrape_runs: {
        Row: {
          active_offers: number | null
          finished_at: string | null
          id: number
          notes: string | null
          offers_found: number | null
          parse_errors: number | null
          platform_id: string | null
          scope: string
          soft_blocks: number | null
          started_at: string
          status: string
        }
        Insert: {
          active_offers?: number | null
          finished_at?: string | null
          id?: never
          notes?: string | null
          offers_found?: number | null
          parse_errors?: number | null
          platform_id?: string | null
          scope?: string
          soft_blocks?: number | null
          started_at: string
          status: string
        }
        Update: {
          active_offers?: number | null
          finished_at?: string | null
          id?: never
          notes?: string | null
          offers_found?: number | null
          parse_errors?: number | null
          platform_id?: string | null
          scope?: string
          soft_blocks?: number | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "scrape_runs_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
        ]
      }
      store_aliases: {
        Row: {
          confidence: string
          platform_id: string
          raw_name: string
          store_id: number | null
        }
        Insert: {
          confidence?: string
          platform_id: string
          raw_name: string
          store_id?: number | null
        }
        Update: {
          confidence?: string
          platform_id?: string
          raw_name?: string
          store_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "store_aliases_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_aliases_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_logo_sources: {
        Row: {
          last_seen_at: string
          platform_id: string
          store_id: number
          url: string
        }
        Insert: {
          last_seen_at: string
          platform_id: string
          store_id: number
          url: string
        }
        Update: {
          last_seen_at?: string
          platform_id?: string
          store_id?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_logo_sources_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_logo_sources_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          created_at: string | null
          id: number
          logo_hash: string | null
          logo_url: string | null
          name: string
          slug: string
        }
        Insert: {
          created_at?: string | null
          id?: never
          logo_hash?: string | null
          logo_url?: string | null
          name: string
          slug: string
        }
        Update: {
          created_at?: string | null
          id?: never
          logo_hash?: string | null
          logo_url?: string | null
          name?: string
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      pipeline_write_offers: {
        Args: {
          p_offers: Json
          p_outcomes?: Json
          p_platform_id: string
          p_run_started_at: string
          p_scope_store_ids?: number[]
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

