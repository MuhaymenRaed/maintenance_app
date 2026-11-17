export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      branch_stock: {
        Row: {
          branch_id: string;
          low_stock_threshold: number;
          qty: number;
          variant_id: string;
        };
        Insert: {
          branch_id: string;
          low_stock_threshold?: number;
          qty?: number;
          variant_id: string;
        };
        Update: {
          branch_id?: string;
          low_stock_threshold?: number;
          qty?: number;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branch_stock_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "branch_stock_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      branches: {
        Row: {
          map_url: string | null;
          address_ar: string | null;
          address_en: string | null;
          closes_at: string | null;
          code: string;
          deleted_at: string | null;
          has_repair_center: boolean;
          id: string;
          is_active: boolean;
          is_deleted: boolean;
          is_main: boolean;
          lat: number | null;
          lng: number | null;
          name_ar: string;
          name_en: string;
          opens_at: string | null;
          phone: string | null;
          province_code: string | null;
          sort_order: number;
          whatsapp: string | null;
        };
        Insert: {
          map_url?: string | null;
          address_ar?: string | null;
          address_en?: string | null;
          closes_at?: string | null;
          code: string;
          deleted_at?: string | null;
          has_repair_center?: boolean;
          id?: string;
          is_active?: boolean;
          is_deleted?: boolean;
          is_main?: boolean;
          lat?: number | null;
          lng?: number | null;
          name_ar: string;
          name_en: string;
          opens_at?: string | null;
          phone?: string | null;
          province_code?: string | null;
          sort_order?: number;
          whatsapp?: string | null;
        };
        Update: {
          map_url?: string | null;
          address_ar?: string | null;
          address_en?: string | null;
          closes_at?: string | null;
          code?: string;
          deleted_at?: string | null;
          has_repair_center?: boolean;
          id?: string;
          is_active?: boolean;
          is_deleted?: boolean;
          is_main?: boolean;
          lat?: number | null;
          lng?: number | null;
          name_ar?: string;
          name_en?: string;
          opens_at?: string | null;
          phone?: string | null;
          province_code?: string | null;
          sort_order?: number;
          whatsapp?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "branches_province_code_fkey";
            columns: ["province_code"];
            isOneToOne: false;
            referencedRelation: "provinces";
            referencedColumns: ["code"];
          },
        ];
      };
      brands: {
        Row: {
          is_official_partner: boolean;
          code: string;
          is_deleted: boolean;
          logo_url: string | null;
          name_ar: string;
          name_en: string;
          search_doc: string | null;
          sort_order: number;
        };
        Insert: {
          is_official_partner?: boolean;
          code: string;
          is_deleted?: boolean;
          logo_url?: string | null;
          name_ar: string;
          name_en: string;
          sort_order?: number;
        };
        Update: {
          is_official_partner?: boolean;
          code?: string;
          is_deleted?: boolean;
          logo_url?: string | null;
          name_ar?: string;
          name_en?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          accent_hex: string;
          code: string;
          deleted_at: string | null;
          icon: string;
          image_url: string | null;
          is_deleted: boolean;
          is_service_only: boolean;
          name_ar: string;
          name_en: string;
          sort_order: number;
        };
        Insert: {
          accent_hex?: string;
          code: string;
          deleted_at?: string | null;
          icon?: string;
          image_url?: string | null;
          is_deleted?: boolean;
          is_service_only?: boolean;
          name_ar: string;
          name_en: string;
          sort_order?: number;
        };
        Update: {
          accent_hex?: string;
          code?: string;
          deleted_at?: string | null;
          icon?: string;
          image_url?: string | null;
          is_deleted?: boolean;
          is_service_only?: boolean;
          name_ar?: string;
          name_en?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      coupon_redemptions: {
        Row: {
          coupon_code: string;
          created_at: string;
          id: string;
          order_code: string | null;
          user_id: string | null;
        };
        Insert: {
          coupon_code: string;
          created_at?: string;
          id?: string;
          order_code?: string | null;
          user_id?: string | null;
        };
        Update: {
          coupon_code?: string;
          created_at?: string;
          id?: string;
          order_code?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_code_fkey";
            columns: ["coupon_code"];
            isOneToOne: false;
            referencedRelation: "coupons";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "coupon_redemptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      coupons: {
        Row: {
          audience: string[] | null;
          active: boolean;
          code: string;
          created_at: string;
          deleted_at: string | null;
          discount_type: Database["public"]["Enums"]["coupon_type"];
          ends_at: string | null;
          is_deleted: boolean;
          min_subtotal: number;
          per_user_limit: number | null;
          product_ids: string[] | null;
          starts_at: string | null;
          target_user_ids: string[] | null;
          title: string | null;
          usage_limit: number | null;
          used_count: number;
          value: number;
        };
        Insert: {
          audience?: string[] | null;
          active?: boolean;
          code: string;
          created_at?: string;
          deleted_at?: string | null;
          discount_type: Database["public"]["Enums"]["coupon_type"];
          ends_at?: string | null;
          is_deleted?: boolean;
          min_subtotal?: number;
          per_user_limit?: number | null;
          product_ids?: string[] | null;
          starts_at?: string | null;
          target_user_ids?: string[] | null;
          title?: string | null;
          usage_limit?: number | null;
          used_count?: number;
          value: number;
        };
        Update: {
          audience?: string[] | null;
          active?: boolean;
          code?: string;
          created_at?: string;
          deleted_at?: string | null;
          discount_type?: Database["public"]["Enums"]["coupon_type"];
          ends_at?: string | null;
          is_deleted?: boolean;
          min_subtotal?: number;
          per_user_limit?: number | null;
          product_ids?: string[] | null;
          starts_at?: string | null;
          target_user_ids?: string[] | null;
          title?: string | null;
          usage_limit?: number | null;
          used_count?: number;
          value?: number;
        };
        Relationships: [];
      };
      featured_group_products: {
        Row: {
          group_id: string;
          product_id: string;
          sort_order: number;
        };
        Insert: {
          group_id: string;
          product_id: string;
          sort_order?: number;
        };
        Update: {
          group_id?: string;
          product_id?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "featured_group_products_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "featured_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "featured_group_products_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      featured_groups: {
        Row: {
          accent_hex: string;
          created_at: string;
          discount_type: string | null;
          discount_value: number | null;
          ends_at: string | null;
          icon: string;
          id: string;
          image_url: string | null;
          is_active: boolean;
          is_deleted: boolean;
          link_scope: Database["public"]["Enums"]["link_scope_type"] | null;
          link_values: string[] | null;
          name_ar: string;
          name_en: string;
          show_on_grid: boolean;
          slot: string | null;
          slug: string | null;
          sort_order: number;
          starts_at: string | null;
        };
        Insert: {
          accent_hex?: string;
          created_at?: string;
          discount_type?: string | null;
          discount_value?: number | null;
          ends_at?: string | null;
          icon?: string;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          is_deleted?: boolean;
          link_scope?: Database["public"]["Enums"]["link_scope_type"] | null;
          link_values?: string[] | null;
          name_ar: string;
          name_en: string;
          show_on_grid?: boolean;
          slot?: string | null;
          slug?: string | null;
          sort_order?: number;
          starts_at?: string | null;
        };
        Update: {
          accent_hex?: string;
          created_at?: string;
          discount_type?: string | null;
          discount_value?: number | null;
          ends_at?: string | null;
          icon?: string;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          is_deleted?: boolean;
          link_scope?: Database["public"]["Enums"]["link_scope_type"] | null;
          link_values?: string[] | null;
          name_ar?: string;
          name_en?: string;
          show_on_grid?: boolean;
          slot?: string | null;
          slug?: string | null;
          sort_order?: number;
          starts_at?: string | null;
        };
        Relationships: [];
      };
      financing_plans: {
        Row: {
          id: string;
          is_active: boolean;
          markup_percent: number;
          min_down_payment_percent: number;
          months: number;
          sort_order: number;
        };
        Insert: {
          id?: string;
          is_active?: boolean;
          markup_percent?: number;
          min_down_payment_percent?: number;
          months: number;
          sort_order?: number;
        };
        Update: {
          id?: string;
          is_active?: boolean;
          markup_percent?: number;
          min_down_payment_percent?: number;
          months?: number;
          sort_order?: number;
        };
        Relationships: [];
      };
      home_tiles: {
        Row: {
          accent_hex: string;
          icon: string;
          image_url: string | null;
          is_active: boolean;
          key: string;
          name_ar: string;
          name_en: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          accent_hex?: string;
          icon?: string;
          image_url?: string | null;
          is_active?: boolean;
          key: string;
          name_ar: string;
          name_en: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          accent_hex?: string;
          icon?: string;
          image_url?: string | null;
          is_active?: boolean;
          key?: string;
          name_ar?: string;
          name_en?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      offers: {
        Row: {
          audience: string[] | null;
          active: boolean;
          buy_qty: number | null;
          created_at: string;
          delivery_fee: number | null;
          ends_at: string | null;
          fixed_amount: number | null;
          free_qty: number | null;
          id: string;
          is_deleted: boolean;
          kind: Database["public"]["Enums"]["offer_kind"];
          min_cart_total: number | null;
          percent: number | null;
          product_id: string | null;
          scope_type: string | null;
          scope_values: string[] | null;
          starts_at: string | null;
          title_ar: string;
          title_en: string;
        };
        Insert: {
          audience?: string[] | null;
          active?: boolean;
          buy_qty?: number | null;
          created_at?: string;
          delivery_fee?: number | null;
          ends_at?: string | null;
          fixed_amount?: number | null;
          free_qty?: number | null;
          id?: string;
          is_deleted?: boolean;
          kind: Database["public"]["Enums"]["offer_kind"];
          min_cart_total?: number | null;
          percent?: number | null;
          product_id?: string | null;
          scope_type?: string | null;
          scope_values?: string[] | null;
          starts_at?: string | null;
          title_ar: string;
          title_en: string;
        };
        Update: {
          audience?: string[] | null;
          active?: boolean;
          buy_qty?: number | null;
          created_at?: string;
          delivery_fee?: number | null;
          ends_at?: string | null;
          fixed_amount?: number | null;
          free_qty?: number | null;
          id?: string;
          is_deleted?: boolean;
          kind?: Database["public"]["Enums"]["offer_kind"];
          min_cart_total?: number | null;
          percent?: number | null;
          product_id?: string | null;
          scope_type?: string | null;
          scope_values?: string[] | null;
          starts_at?: string | null;
          title_ar?: string;
          title_en?: string;
        };
        Relationships: [
          {
            foreignKeyName: "offers_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          free_qty: number;
          id: string;
          line_total: number;
          name_ar_snapshot: string;
          name_en_snapshot: string;
          note: string | null;
          order_id: string;
          product_id: string | null;
          product_unit_id: string | null;
          qty: number;
          unit_price: number;
          variant_id: string | null;
          variant_label_ar: string | null;
          variant_label_en: string | null;
        };
        Insert: {
          free_qty?: number;
          id?: string;
          line_total: number;
          name_ar_snapshot: string;
          name_en_snapshot: string;
          note?: string | null;
          order_id: string;
          product_id?: string | null;
          product_unit_id?: string | null;
          qty?: number;
          unit_price: number;
          variant_id?: string | null;
          variant_label_ar?: string | null;
          variant_label_en?: string | null;
        };
        Update: {
          free_qty?: number;
          id?: string;
          line_total?: number;
          name_ar_snapshot?: string;
          name_en_snapshot?: string;
          note?: string | null;
          order_id?: string;
          product_id?: string | null;
          product_unit_id?: string | null;
          qty?: number;
          unit_price?: number;
          variant_id?: string | null;
          variant_label_ar?: string | null;
          variant_label_en?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_unit_id_fkey";
            columns: ["product_unit_id"];
            isOneToOne: false;
            referencedRelation: "product_units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          address_line: string | null;
          branch_id: string | null;
          code: string;
          coupon_code: string | null;
          created_at: string;
          customer_name: string;
          customer_phone: string;
          customer_phone2: string | null;
          deleted_at: string | null;
          delivery_fee: number;
          discount_total: number;
          fulfillment_method: Database["public"]["Enums"]["fulfillment_method"];
          id: string;
          installment_down_payment: number | null;
          installment_months: number | null;
          is_deleted: boolean;
          notes: string | null;
          offer_note: string | null;
          payment_method: Database["public"]["Enums"]["payment_method"];
          province_code: string | null;
          status: Database["public"]["Enums"]["order_status"];
          subtotal: number;
          total: number;
          tracking: string | null;
          trade_in_credit_applied: number;
          trade_in_id: string | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          address_line?: string | null;
          branch_id?: string | null;
          code?: string;
          coupon_code?: string | null;
          created_at?: string;
          customer_name: string;
          customer_phone: string;
          customer_phone2?: string | null;
          deleted_at?: string | null;
          delivery_fee?: number;
          discount_total?: number;
          fulfillment_method?: Database["public"]["Enums"]["fulfillment_method"];
          id?: string;
          installment_down_payment?: number | null;
          installment_months?: number | null;
          is_deleted?: boolean;
          notes?: string | null;
          offer_note?: string | null;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          province_code?: string | null;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal?: number;
          total?: number;
          tracking?: string | null;
          trade_in_credit_applied?: number;
          trade_in_id?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          address_line?: string | null;
          branch_id?: string | null;
          code?: string;
          coupon_code?: string | null;
          created_at?: string;
          customer_name?: string;
          customer_phone?: string;
          customer_phone2?: string | null;
          deleted_at?: string | null;
          delivery_fee?: number;
          discount_total?: number;
          fulfillment_method?: Database["public"]["Enums"]["fulfillment_method"];
          id?: string;
          installment_down_payment?: number | null;
          installment_months?: number | null;
          is_deleted?: boolean;
          notes?: string | null;
          offer_note?: string | null;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          province_code?: string | null;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal?: number;
          total?: number;
          tracking?: string | null;
          trade_in_credit_applied?: number;
          trade_in_id?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "fk_orders_tradein";
            columns: ["trade_in_id"];
            isOneToOne: false;
            referencedRelation: "trade_in_offers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_province_code_fkey";
            columns: ["province_code"];
            isOneToOne: false;
            referencedRelation: "provinces";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "orders_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      promo_slides: {
        Row: {
          created_at: string;
          ends_at: string | null;
          id: string;
          image_url: string;
          image_url_mobile: string | null;
          is_active: boolean;
          link_kind: Database["public"]["Enums"]["promo_link_kind"];
          link_value: string;
          placement: string;
          sort_order: number;
          starts_at: string | null;
          subtitle_ar: string;
          subtitle_en: string;
          title_ar: string;
          title_en: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          ends_at?: string | null;
          id?: string;
          image_url: string;
          image_url_mobile?: string | null;
          is_active?: boolean;
          link_kind: Database["public"]["Enums"]["promo_link_kind"];
          link_value: string;
          placement?: string;
          sort_order?: number;
          starts_at?: string | null;
          subtitle_ar?: string;
          subtitle_en?: string;
          title_ar: string;
          title_en: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          ends_at?: string | null;
          id?: string;
          image_url?: string;
          image_url_mobile?: string | null;
          is_active?: boolean;
          link_kind?: Database["public"]["Enums"]["promo_link_kind"];
          link_value?: string;
          placement?: string;
          sort_order?: number;
          starts_at?: string | null;
          subtitle_ar?: string;
          subtitle_en?: string;
          title_ar?: string;
          title_en?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      product_categories: {
        Row: {
          category_code: string;
          product_id: string;
        };
        Insert: {
          category_code: string;
          product_id: string;
        };
        Update: {
          category_code?: string;
          product_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_categories_category_code_fkey";
            columns: ["category_code"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "product_categories_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_images: {
        Row: {
          alt_ar: string | null;
          alt_en: string | null;
          blur_data: string | null;
          created_at: string;
          id: string;
          product_id: string;
          sort_order: number;
          url: string;
          variant_id: string | null;
        };
        Insert: {
          alt_ar?: string | null;
          alt_en?: string | null;
          blur_data?: string | null;
          created_at?: string;
          id?: string;
          product_id: string;
          sort_order?: number;
          url: string;
          variant_id?: string | null;
        };
        Update: {
          alt_ar?: string | null;
          alt_en?: string | null;
          blur_data?: string | null;
          created_at?: string;
          id?: string;
          product_id?: string;
          sort_order?: number;
          url?: string;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_images_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      product_reviews: {
        Row: {
          author_name: string | null;
          helpful_count: number;
          is_verified_buyer: boolean;
          body: string | null;
          created_at: string;
          id: string;
          is_deleted: boolean;
          order_item_id: string | null;
          product_id: string;
          rating: number;
          title: string | null;
          user_id: string;
        };
        Insert: {
          author_name?: string | null;
          helpful_count?: number;
          is_verified_buyer?: boolean;
          body?: string | null;
          created_at?: string;
          id?: string;
          is_deleted?: boolean;
          order_item_id?: string | null;
          product_id: string;
          rating: number;
          title?: string | null;
          user_id: string;
        };
        Update: {
          author_name?: string | null;
          helpful_count?: number;
          is_verified_buyer?: boolean;
          body?: string | null;
          created_at?: string;
          id?: string;
          is_deleted?: boolean;
          order_item_id?: string | null;
          product_id?: string;
          rating?: number;
          title?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fk_reviews_order_item";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_reviews_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_reviews_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      product_subcategories: {
        Row: {
          product_id: string;
          subcategory_code: string;
        };
        Insert: {
          product_id: string;
          subcategory_code: string;
        };
        Update: {
          product_id?: string;
          subcategory_code?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_subcategories_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_subcategories_subcategory_code_fkey";
            columns: ["subcategory_code"];
            isOneToOne: false;
            referencedRelation: "subcategories";
            referencedColumns: ["code"];
          },
        ];
      };
      product_units: {
        Row: {
          acquired_via: Database["public"]["Enums"]["acquisition_source"];
          branch_id: string;
          condition: Database["public"]["Enums"]["product_condition"];
          cost_price: number | null;
          created_at: string;
          id: string;
          imei_or_serial: string | null;
          sold_order_item_id: string | null;
          status: Database["public"]["Enums"]["unit_status"];
          trade_in_id: string | null;
          updated_at: string;
          variant_id: string;
        };
        Insert: {
          acquired_via?: Database["public"]["Enums"]["acquisition_source"];
          branch_id: string;
          condition?: Database["public"]["Enums"]["product_condition"];
          cost_price?: number | null;
          created_at?: string;
          id?: string;
          imei_or_serial?: string | null;
          sold_order_item_id?: string | null;
          status?: Database["public"]["Enums"]["unit_status"];
          trade_in_id?: string | null;
          updated_at?: string;
          variant_id: string;
        };
        Update: {
          acquired_via?: Database["public"]["Enums"]["acquisition_source"];
          branch_id?: string;
          condition?: Database["public"]["Enums"]["product_condition"];
          cost_price?: number | null;
          created_at?: string;
          id?: string;
          imei_or_serial?: string | null;
          sold_order_item_id?: string | null;
          status?: Database["public"]["Enums"]["unit_status"];
          trade_in_id?: string | null;
          updated_at?: string;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fk_units_sold_item";
            columns: ["sold_order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_units_tradein";
            columns: ["trade_in_id"];
            isOneToOne: false;
            referencedRelation: "trade_in_offers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_units_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_units_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      product_variants: {
        Row: {
          color_hex: string | null;
          color_name_ar: string | null;
          color_name_en: string | null;
          id: string;
          is_active: boolean;
          is_deleted: boolean;
          price: number | null;
          product_id: string;
          ram_gb: number | null;
          sku: string | null;
          sort_order: number;
          storage_gb: number | null;
        };
        Insert: {
          color_hex?: string | null;
          color_name_ar?: string | null;
          color_name_en?: string | null;
          id?: string;
          is_active?: boolean;
          is_deleted?: boolean;
          price?: number | null;
          product_id: string;
          ram_gb?: number | null;
          sku?: string | null;
          sort_order?: number;
          storage_gb?: number | null;
        };
        Update: {
          color_hex?: string | null;
          color_name_ar?: string | null;
          color_name_en?: string | null;
          id?: string;
          is_active?: boolean;
          is_deleted?: boolean;
          price?: number | null;
          product_id?: string;
          ram_gb?: number | null;
          sku?: string | null;
          sort_order?: number;
          storage_gb?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          slug: string;
          allow_installment: boolean;
          badge: Database["public"]["Enums"]["badge_type"] | null;
          base_price: number;
          brand_code: string | null;
          category_code: string;
          created_at: string;
          deleted_at: string | null;
          description_ar: string;
          description_en: string;
          discount_fixed: number;
          discount_percent: number;
          id: string;
          image_url: string | null;
          images: string[];
          is_active: boolean;
          is_deleted: boolean;
          is_featured: boolean;
          kind: Database["public"]["Enums"]["product_kind"];
          name_ar: string;
          name_en: string;
          offer_group_id: string | null;
          rating_avg: number;
          rating_count: number;
          search_doc: string | null;
          sold_out: boolean;
          sort_order: number;
          spec: Json;
          sub_ar: string;
          sub_en: string;
          tags: string[];
          updated_at: string;
          warranty_months: number;
        };
        Insert: {
          slug?: string;
          allow_installment?: boolean;
          badge?: Database["public"]["Enums"]["badge_type"] | null;
          base_price: number;
          brand_code?: string | null;
          category_code: string;
          created_at?: string;
          deleted_at?: string | null;
          description_ar?: string;
          description_en?: string;
          discount_fixed?: number;
          discount_percent?: number;
          id?: string;
          image_url?: string | null;
          images?: string[];
          is_active?: boolean;
          is_deleted?: boolean;
          is_featured?: boolean;
          kind?: Database["public"]["Enums"]["product_kind"];
          name_ar: string;
          name_en: string;
          offer_group_id?: string | null;
          rating_avg?: number;
          rating_count?: number;
          sold_out?: boolean;
          sort_order?: number;
          spec?: Json;
          sub_ar?: string;
          sub_en?: string;
          tags?: string[];
          updated_at?: string;
          warranty_months?: number;
        };
        Update: {
          slug?: string;
          allow_installment?: boolean;
          badge?: Database["public"]["Enums"]["badge_type"] | null;
          base_price?: number;
          brand_code?: string | null;
          category_code?: string;
          created_at?: string;
          deleted_at?: string | null;
          description_ar?: string;
          description_en?: string;
          discount_fixed?: number;
          discount_percent?: number;
          id?: string;
          image_url?: string | null;
          images?: string[];
          is_active?: boolean;
          is_deleted?: boolean;
          is_featured?: boolean;
          kind?: Database["public"]["Enums"]["product_kind"];
          name_ar?: string;
          name_en?: string;
          offer_group_id?: string | null;
          rating_avg?: number;
          rating_count?: number;
          sold_out?: boolean;
          sort_order?: number;
          spec?: Json;
          sub_ar?: string;
          sub_en?: string;
          tags?: string[];
          updated_at?: string;
          warranty_months?: number;
        };
        Relationships: [
          {
            foreignKeyName: "products_brand_code_fkey";
            columns: ["brand_code"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "products_category_code_fkey";
            columns: ["category_code"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["code"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          default_branch_id: string | null;
          default_province_code: string | null;
          full_name: string | null;
          manager_id: string | null;
          id: string;
          phone: string | null;
          phone2: string | null;
          role: Database["public"]["Enums"]["user_role"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          default_branch_id?: string | null;
          default_province_code?: string | null;
          full_name?: string | null;
          manager_id?: string | null;
          id: string;
          phone?: string | null;
          phone2?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          default_branch_id?: string | null;
          default_province_code?: string | null;
          full_name?: string | null;
          manager_id?: string | null;
          id?: string;
          phone?: string | null;
          phone2?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_default_branch_id_fkey";
            columns: ["default_branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_default_province_code_fkey";
            columns: ["default_province_code"];
            isOneToOne: false;
            referencedRelation: "provinces";
            referencedColumns: ["code"];
          },
        ];
      };
      provinces: {
        Row: {
          code: string;
          name_ar: string;
          name_en: string;
          sort_order: number;
        };
        Insert: {
          code: string;
          name_ar: string;
          name_en: string;
          sort_order?: number;
        };
        Update: {
          code?: string;
          name_ar?: string;
          name_en?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      repair_issues: {
        Row: {
          code: string;
          is_deleted: boolean;
          name_ar: string;
          name_en: string;
          sort_order: number;
        };
        Insert: {
          code: string;
          is_deleted?: boolean;
          name_ar: string;
          name_en: string;
          sort_order?: number;
        };
        Update: {
          code?: string;
          is_deleted?: boolean;
          name_ar?: string;
          name_en?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      repair_pricing: {
        Row: {
          brand_code: string | null;
          eta_hours_max: number;
          eta_hours_min: number;
          id: string;
          is_deleted: boolean;
          issue_code: string;
          price_max: number;
          price_min: number;
        };
        Insert: {
          brand_code?: string | null;
          eta_hours_max?: number;
          eta_hours_min?: number;
          id?: string;
          is_deleted?: boolean;
          issue_code: string;
          price_max: number;
          price_min: number;
        };
        Update: {
          brand_code?: string | null;
          eta_hours_max?: number;
          eta_hours_min?: number;
          id?: string;
          is_deleted?: boolean;
          issue_code?: string;
          price_max?: number;
          price_min?: number;
        };
        Relationships: [
          {
            foreignKeyName: "repair_pricing_brand_code_fkey";
            columns: ["brand_code"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "repair_pricing_issue_code_fkey";
            columns: ["issue_code"];
            isOneToOne: false;
            referencedRelation: "repair_issues";
            referencedColumns: ["code"];
          },
        ];
      };
      repair_ticket_issues: {
        Row: {
          issue_code: string;
          ticket_id: string;
        };
        Insert: {
          issue_code: string;
          ticket_id: string;
        };
        Update: {
          issue_code?: string;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "repair_ticket_issues_issue_code_fkey";
            columns: ["issue_code"];
            isOneToOne: false;
            referencedRelation: "repair_issues";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "repair_ticket_issues_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "repair_tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      repair_ticket_parts: {
        Row: {
          created_at: string;
          description: string;
          id: string;
          qty: number;
          ticket_id: string;
          unit_cost: number;
          variant_id: string | null;
        };
        Insert: {
          created_at?: string;
          description: string;
          id?: string;
          qty?: number;
          ticket_id: string;
          unit_cost?: number;
          variant_id?: string | null;
        };
        Update: {
          created_at?: string;
          description?: string;
          id?: string;
          qty?: number;
          ticket_id?: string;
          unit_cost?: number;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "repair_ticket_parts_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "repair_tickets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "repair_ticket_parts_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      repair_tickets: {
        Row: {
          actual_cost: number | null;
          address_line: string | null;
          approved_at: string | null;
          branch_id: string | null;
          brand_code: string | null;
          code: string;
          created_at: string;
          customer_name: string;
          customer_phone: string;
          customer_phone2: string | null;
          deleted_at: string | null;
          device_model: string;
          fulfillment: Database["public"]["Enums"]["repair_fulfillment"];
          id: string;
          is_deleted: boolean;
          notes: string | null;
          photos_after: string[];
          photos_before: string[];
          preferred_at: string | null;
          quote_amount: number | null;
          quote_notes: string | null;
          quote_sent_at: string | null;
          status: Database["public"]["Enums"]["repair_status"];
          technician_id: string | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          actual_cost?: number | null;
          address_line?: string | null;
          approved_at?: string | null;
          branch_id?: string | null;
          brand_code?: string | null;
          code?: string;
          created_at?: string;
          customer_name: string;
          customer_phone: string;
          customer_phone2?: string | null;
          deleted_at?: string | null;
          device_model: string;
          fulfillment?: Database["public"]["Enums"]["repair_fulfillment"];
          id?: string;
          is_deleted?: boolean;
          notes?: string | null;
          photos_after?: string[];
          photos_before?: string[];
          preferred_at?: string | null;
          quote_amount?: number | null;
          quote_notes?: string | null;
          quote_sent_at?: string | null;
          status?: Database["public"]["Enums"]["repair_status"];
          technician_id?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          actual_cost?: number | null;
          address_line?: string | null;
          approved_at?: string | null;
          branch_id?: string | null;
          brand_code?: string | null;
          code?: string;
          created_at?: string;
          customer_name?: string;
          customer_phone?: string;
          customer_phone2?: string | null;
          deleted_at?: string | null;
          device_model?: string;
          fulfillment?: Database["public"]["Enums"]["repair_fulfillment"];
          id?: string;
          is_deleted?: boolean;
          notes?: string | null;
          photos_after?: string[];
          photos_before?: string[];
          preferred_at?: string | null;
          quote_amount?: number | null;
          quote_notes?: string | null;
          quote_sent_at?: string | null;
          status?: Database["public"]["Enums"]["repair_status"];
          technician_id?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "repair_tickets_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "repair_tickets_brand_code_fkey";
            columns: ["brand_code"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "repair_tickets_technician_id_fkey";
            columns: ["technician_id"];
            isOneToOne: false;
            referencedRelation: "technicians";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "repair_tickets_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      settings: {
        Row: {
          announcement_active: boolean;
          announcement_ar: string | null;
          announcement_en: string | null;
          delivery_fee_default: number;
          delivery_fee_local: number;
          id: boolean;
          instagram_url: string | null;
          occasion_mode: boolean;
          stat_branches: number;
          stat_repairs_monthly: number;
          stat_since_year: number;
          stat_staff: number;
          updated_at: string;
          whatsapp_number: string | null;
        };
        Insert: {
          announcement_active?: boolean;
          announcement_ar?: string | null;
          announcement_en?: string | null;
          delivery_fee_default?: number;
          delivery_fee_local?: number;
          id?: boolean;
          instagram_url?: string | null;
          occasion_mode?: boolean;
          stat_branches?: number;
          stat_repairs_monthly?: number;
          stat_since_year?: number;
          stat_staff?: number;
          updated_at?: string;
          whatsapp_number?: string | null;
        };
        Update: {
          announcement_active?: boolean;
          announcement_ar?: string | null;
          announcement_en?: string | null;
          delivery_fee_default?: number;
          delivery_fee_local?: number;
          id?: boolean;
          instagram_url?: string | null;
          occasion_mode?: boolean;
          stat_branches?: number;
          stat_repairs_monthly?: number;
          stat_since_year?: number;
          stat_staff?: number;
          updated_at?: string;
          whatsapp_number?: string | null;
        };
        Relationships: [];
      };
      staff_access: {
        Row: {
          capabilities: string[] | null;
          note: string | null;
          sections: string[] | null;
          title: string | null;
          updated_at: string;
          updated_by: string | null;
          user_id: string;
        };
        Insert: {
          capabilities?: string[] | null;
          note?: string | null;
          sections?: string[] | null;
          title?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          user_id: string;
        };
        Update: {
          capabilities?: string[] | null;
          note?: string | null;
          sections?: string[] | null;
          title?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      staff_activity: {
        Row: {
          action: string;
          actor_id: string;
          actor_role: string;
          amount: number | null;
          created_at: string;
          detail: Json;
          entity: string;
          entity_id: string | null;
          id: string;
        };
        Insert: {
          action: string;
          actor_id: string;
          actor_role: string;
          amount?: number | null;
          created_at?: string;
          detail?: Json;
          entity: string;
          entity_id?: string | null;
          id?: string;
        };
        Update: {
          action?: string;
          actor_id?: string;
          actor_role?: string;
          amount?: number | null;
          created_at?: string;
          detail?: Json;
          entity?: string;
          entity_id?: string | null;
          id?: string;
        };
        Relationships: [];
      };
      subcategories: {
        Row: {
          category_code: string;
          code: string;
          created_at: string;
          is_deleted: boolean;
          name_ar: string;
          name_en: string;
          sort_order: number;
        };
        Insert: {
          category_code: string;
          code: string;
          created_at?: string;
          is_deleted?: boolean;
          name_ar: string;
          name_en: string;
          sort_order?: number;
        };
        Update: {
          category_code?: string;
          code?: string;
          created_at?: string;
          is_deleted?: boolean;
          name_ar?: string;
          name_en?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "subcategories_category_code_fkey";
            columns: ["category_code"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["code"];
          },
        ];
      };
      technicians: {
        Row: {
          avatar_url: string | null;
          branch_id: string | null;
          id: string;
          is_active: boolean;
          is_deleted: boolean;
          name: string;
          phone: string | null;
          sort_order: number;
          user_id: string | null;
        };
        Insert: {
          avatar_url?: string | null;
          branch_id?: string | null;
          id?: string;
          is_active?: boolean;
          is_deleted?: boolean;
          name: string;
          phone?: string | null;
          sort_order?: number;
          user_id?: string | null;
        };
        Update: {
          avatar_url?: string | null;
          branch_id?: string | null;
          id?: string;
          is_active?: boolean;
          is_deleted?: boolean;
          name?: string;
          phone?: string | null;
          sort_order?: number;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "technicians_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "technicians_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      trade_in_offers: {
        Row: {
          branch_id: string | null;
          brand_code: string | null;
          code: string;
          condition_answers: Json;
          created_at: string;
          credited_order_id: string | null;
          customer_name: string;
          customer_phone: string;
          customer_phone2: string | null;
          device_model: string;
          estimated_max: number | null;
          estimated_min: number | null;
          final_offer: number | null;
          id: string;
          is_deleted: boolean;
          photos: string[];
          preferred_at: string | null;
          status: Database["public"]["Enums"]["trade_in_status"];
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          branch_id?: string | null;
          brand_code?: string | null;
          code?: string;
          condition_answers?: Json;
          created_at?: string;
          credited_order_id?: string | null;
          customer_name: string;
          customer_phone: string;
          customer_phone2?: string | null;
          device_model: string;
          estimated_max?: number | null;
          estimated_min?: number | null;
          final_offer?: number | null;
          id?: string;
          is_deleted?: boolean;
          photos?: string[];
          preferred_at?: string | null;
          status?: Database["public"]["Enums"]["trade_in_status"];
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          branch_id?: string | null;
          brand_code?: string | null;
          code?: string;
          condition_answers?: Json;
          created_at?: string;
          credited_order_id?: string | null;
          customer_name?: string;
          customer_phone?: string;
          customer_phone2?: string | null;
          device_model?: string;
          estimated_max?: number | null;
          estimated_min?: number | null;
          final_offer?: number | null;
          id?: string;
          is_deleted?: boolean;
          photos?: string[];
          preferred_at?: string | null;
          status?: Database["public"]["Enums"]["trade_in_status"];
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "trade_in_offers_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trade_in_offers_brand_code_fkey";
            columns: ["brand_code"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "trade_in_offers_credited_order_id_fkey";
            columns: ["credited_order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trade_in_offers_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      trade_in_pricing: {
        Row: {
          base_value: number;
          brand_code: string | null;
          condition_multipliers: Json;
          device_model_pattern: string;
          id: string;
          is_deleted: boolean;
        };
        Insert: {
          base_value: number;
          brand_code?: string | null;
          condition_multipliers?: Json;
          device_model_pattern: string;
          id?: string;
          is_deleted?: boolean;
        };
        Update: {
          base_value?: number;
          brand_code?: string | null;
          condition_multipliers?: Json;
          device_model_pattern?: string;
          id?: string;
          is_deleted?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "trade_in_pricing_brand_code_fkey";
            columns: ["brand_code"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["code"];
          },
        ];
      };
      staff_profiles: {
        Row: {
          bio_ar: string;
          bio_en: string;
          branch_id: string | null;
          created_at: string;
          display_name_ar: string;
          display_name_en: string;
          is_public: boolean;
          photo_url: string | null;
          sort_order: number;
          title_ar: string;
          title_en: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          bio_ar?: string;
          bio_en?: string;
          branch_id?: string | null;
          created_at?: string;
          display_name_ar: string;
          display_name_en: string;
          is_public?: boolean;
          photo_url?: string | null;
          sort_order?: number;
          title_ar?: string;
          title_en?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          bio_ar?: string;
          bio_en?: string;
          branch_id?: string | null;
          created_at?: string;
          display_name_ar?: string;
          display_name_en?: string;
          is_public?: boolean;
          photo_url?: string | null;
          sort_order?: number;
          title_ar?: string;
          title_en?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_profiles_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_profiles_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      staff_ratings: {
        Row: {
          created_at: string;
          id: string;
          improve: string | null;
          praise: string | null;
          province_code: string;
          rater_email: string | null;
          rater_name: string;
          rater_phone: string;
          rater_user_id: string | null;
          score: number;
          staff_user_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          improve?: string | null;
          praise?: string | null;
          province_code: string;
          rater_email?: string | null;
          rater_name?: string;
          rater_phone: string;
          rater_user_id?: string | null;
          score: number;
          staff_user_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          improve?: string | null;
          praise?: string | null;
          province_code?: string;
          rater_email?: string | null;
          rater_name?: string;
          rater_phone?: string;
          rater_user_id?: string | null;
          score?: number;
          staff_user_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_ratings_staff_user_id_fkey";
            columns: ["staff_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      warranty_registrations: {
        Row: {
          created_at: string;
          customer_name: string | null;
          customer_phone: string | null;
          id: string;
          order_item_id: string | null;
          product_unit_id: string | null;
          serial_or_imei: string | null;
          status: Database["public"]["Enums"]["warranty_status"];
          user_id: string | null;
          warranty_months: number;
          warranty_start: string;
        };
        Insert: {
          created_at?: string;
          customer_name?: string | null;
          customer_phone?: string | null;
          id?: string;
          order_item_id?: string | null;
          product_unit_id?: string | null;
          serial_or_imei?: string | null;
          status?: Database["public"]["Enums"]["warranty_status"];
          user_id?: string | null;
          warranty_months?: number;
          warranty_start?: string;
        };
        Update: {
          created_at?: string;
          customer_name?: string | null;
          customer_phone?: string | null;
          id?: string;
          order_item_id?: string | null;
          product_unit_id?: string | null;
          serial_or_imei?: string | null;
          status?: Database["public"]["Enums"]["warranty_status"];
          user_id?: string | null;
          warranty_months?: number;
          warranty_start?: string;
        };
        Relationships: [
          {
            foreignKeyName: "warranty_registrations_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "warranty_registrations_product_unit_id_fkey";
            columns: ["product_unit_id"];
            isOneToOne: false;
            referencedRelation: "product_units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "warranty_registrations_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      staff_public_ratings: {
        Row: {
          rating_avg: number | null;
          rating_count: number | null;
          staff_user_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "staff_ratings_staff_user_id_fkey";
            columns: ["staff_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      admin_set_product_categories: {
        Args: { p_codes: string[]; p_id: string };
        Returns: string[];
      };
      book_repair: {
        // See the note on `place_order` — nullable in Postgres, required only
        // in the generated output.
        Args: {
          p_address_line: string | null;
          p_branch_id: string | null;
          p_brand_code: string | null;
          p_customer_name: string;
          p_customer_phone: string;
          p_customer_phone2: string | null;
          p_device_model: string;
          p_fulfillment: Database["public"]["Enums"]["repair_fulfillment"];
          p_issue_codes: string[];
          p_notes: string | null;
          p_photos: string[];
          p_preferred_at: string | null;
        };
        Returns: Json;
      };
      cancel_order_guest: {
        Args: { p_code: string; p_phone: string };
        Returns: Json;
      };
      dashboard_stats: { Args: never; Returns: Json };
      /**
       * Added by hand, like the widened `place_order` args below: the
       * generator emits function arguments as non-nullable and this file is
       * deliberately patched rather than regenerated. Re-apply after any
       * `supabase gen types` run.
       */
      delivery_fee_for: {
        Args: {
          p_fulfillment: Database["public"]["Enums"]["fulfillment_method"];
          p_product_ids: string[];
          p_subtotal: number;
        };
        Returns: number;
      };
      effective_price: {
        Args: { base: number; fixed: number; pct: number };
        Returns: number;
      };
      is_admin: { Args: never; Returns: boolean };
      is_staff: { Args: never; Returns: boolean };
      my_staff_ratings: {
        Args: { p_phone: string };
        Returns: {
          created_at: string;
          improve: string;
          praise: string;
          score: number;
          staff_user_id: string;
        }[];
      };
      rate_staff_member: {
        Args: {
          p_email?: string;
          p_improve?: string;
          p_name: string;
          p_phone: string;
          p_praise?: string;
          p_score: number;
          p_staff_id: string;
        };
        Returns: string;
      };
      staff_rating_eligibility: {
        Args: { p_phone: string };
        Returns: {
          eligible: boolean;
          province_code: string;
          reason: string;
        }[];
      };
      place_order: {
        // Every optional parameter below is genuinely nullable in Postgres —
        // the generator cannot see that and emitted them all as required. A
        // pickup order sends no province or address, a cash order sends no
        // instalment fields, so widening these is what the database actually
        // accepts. Re-apply after any `supabase gen types` run.
        Args: {
          p_address_line: string | null;
          p_branch_id: string | null;
          p_coupon_code: string | null;
          p_customer_name: string;
          p_customer_phone: string;
          p_customer_phone2: string | null;
          p_fulfillment: Database["public"]["Enums"]["fulfillment_method"];
          p_installment_down_payment: number | null;
          p_installment_months: number | null;
          p_items: Json;
          p_notes: string | null;
          p_payment_method: Database["public"]["Enums"]["payment_method"];
          p_province_code: string | null;
          p_trade_in_id: string | null;
        };
        Returns: Json;
      };
      preview_coupon: {
        Args: { p_code: string; p_subtotal: number };
        Returns: Json;
      };
      product_branch_stock: { Args: { p_product_id: string }; Returns: Json };
      respond_to_repair_quote: {
        Args: { p_approve: boolean; p_code: string; p_phone: string };
        Returns: Json;
      };
      search_products: {
        Args: { match_limit?: number; search_term: string };
        Returns: {
          id: string;
          score: number;
        }[];
      };
      search_normalize: { Args: { input: string }; Returns: string };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
      store_facets: {
        Args: { p_categories?: string[]; p_query?: string };
        Returns: Json;
      };
      store_search_products: {
        Args: {
          p_brands?: string[];
          p_branches?: string[];
          p_categories?: string[];
          p_colors?: string[];
          p_conditions?: string[];
          p_discounted?: boolean;
          p_in_stock?: boolean;
          p_installment?: boolean;
          p_max_price?: number;
          p_min_price?: number;
          p_min_rating?: number;
          p_page?: number;
          p_page_size?: number;
          p_query?: string;
          p_ram?: number[];
          p_sort?: string;
          p_storage?: number[];
        };
        Returns: {
          accent_hex: string;
          allow_installment: boolean;
          badge: Database["public"]["Enums"]["badge_type"] | null;
          base_price: number;
          brand_code: string | null;
          brand_name_ar: string | null;
          brand_name_en: string | null;
          category_code: string;
          discount_percent: number;
          effective_price: number;
          id: string;
          image_url: string | null;
          name_ar: string;
          name_en: string;
          ram_options: number[] | null;
          rating_avg: number;
          rating_count: number;
          sold_out: boolean;
          storage_options: number[] | null;
          sub_ar: string;
          sub_en: string;
          total_count: number;
          units_sold: number;
          warranty_months: number;
        }[];
      };
      submit_trade_in: {
        // See the note on `place_order`.
        Args: {
          p_branch_id: string | null;
          p_brand_code: string | null;
          p_condition_answers: Json;
          p_customer_name: string;
          p_customer_phone: string;
          p_customer_phone2: string | null;
          p_device_model: string;
          p_photos: string[];
          p_preferred_at: string | null;
        };
        Returns: Json;
      };
      track_order: { Args: { p_code: string; p_phone: string }; Returns: Json };
      track_repair: {
        Args: { p_code: string; p_phone: string };
        Returns: Json;
      };
      track_trade_in: {
        Args: { p_code: string; p_phone: string };
        Returns: Json;
      };
    };
    Enums: {
      acquisition_source: "purchase" | "trade_in";
      badge_type: "bestseller" | "new" | "refurbished_deal";
      coupon_type: "percent" | "fixed";
      fulfillment_method: "delivery" | "pickup";
      link_scope_type: "category" | "subcategory" | "brand";
      offer_kind: "bundle" | "cart_percent" | "cart_delivery" | "flash";
      order_status:
        | "review"
        | "accepted"
        | "preparing"
        | "shipped"
        | "delivered"
        | "cancelled";
      payment_method: "cash" | "installment" | "card" | "transfer";
      product_condition: "new" | "refurbished" | "open_box";
      product_kind: "device" | "accessory" | "package";
      promo_link_kind:
        | "product"
        | "category"
        | "brand"
        | "collection"
        | "shortcut"
        | "page";
      repair_fulfillment: "drop_off" | "pickup";
      repair_status:
        | "received"
        | "diagnosing"
        | "waiting_parts"
        | "quote_sent"
        | "approved"
        | "declined"
        | "in_repair"
        | "quality_check"
        | "work_done"
        | "ready"
        | "completed"
        | "cancelled";
      trade_in_status:
        | "pending"
        | "approved"
        | "inspecting"
        | "declined"
        | "completed";
      unit_status:
        "in_stock" | "reserved" | "sold" | "in_repair_loaner" | "write_off";
      user_role:
        | "customer"
        | "admin"
        | "technician"
        | "super_admin"
        | "sales_admin"
        | "repair_admin"
        | "trade_admin";
      warranty_status: "active" | "expired" | "void";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      acquisition_source: ["purchase", "trade_in"],
      badge_type: ["bestseller", "new", "refurbished_deal"],
      coupon_type: ["percent", "fixed"],
      fulfillment_method: ["delivery", "pickup"],
      link_scope_type: ["category", "subcategory", "brand"],
      offer_kind: ["bundle", "cart_percent", "cart_delivery", "flash"],
      order_status: [
        "review",
        "accepted",
        "preparing",
        "shipped",
        "delivered",
        "cancelled",
      ],
      payment_method: ["cash", "installment", "card", "transfer"],
      product_condition: ["new", "refurbished", "open_box"],
      product_kind: ["device", "accessory", "package"],
      repair_fulfillment: ["drop_off", "pickup"],
      repair_status: [
        "received",
        "diagnosing",
        "waiting_parts",
        "quote_sent",
        "approved",
        "declined",
        "in_repair",
        "quality_check",
        "work_done",
        "ready",
        "completed",
        "cancelled",
      ],
      trade_in_status: ["pending", "approved", "inspecting", "declined", "completed"],
      unit_status: [
        "in_stock",
        "reserved",
        "sold",
        "in_repair_loaner",
        "write_off",
      ],
      user_role: [
        "customer",
        "admin",
        "technician",
        "super_admin",
        "sales_admin",
        "repair_admin",
        "trade_admin",
      ],
      warranty_status: ["active", "expired", "void"],
    },
  },
} as const;
