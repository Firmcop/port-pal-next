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
      accounting_policies: {
        Row: {
          created_at: string
          id: string
          netting_enabled: boolean
          offset_approval_threshold: number
          organization_id: string
          policy_note: string | null
          presentation_basis: string
          require_setoff_evidence: boolean
          same_currency_only: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          netting_enabled?: boolean
          offset_approval_threshold?: number
          organization_id: string
          policy_note?: string | null
          presentation_basis?: string
          require_setoff_evidence?: boolean
          same_currency_only?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          netting_enabled?: boolean
          offset_approval_threshold?: number
          organization_id?: string
          policy_note?: string | null
          presentation_basis?: string
          require_setoff_evidence?: boolean
          same_currency_only?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      accounting_transactions: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          base_currency: string | null
          category: string
          cleared_at: string | null
          created_at: string
          created_by: string | null
          credit_amount: number
          currency: string | null
          debit_amount: number
          depot_id: string | null
          description: string
          financial_account_id: string | null
          fx_rate: number | null
          gl_account_id: string | null
          id: string
          journal_id: string | null
          organization_id: string
          project_id: string | null
          reconciliation_id: string | null
          reference_id: string | null
          reference_type: string | null
          transaction_date: string
          transaction_number: string
        }
        Insert: {
          account_type: Database["public"]["Enums"]["account_type"]
          base_currency?: string | null
          category: string
          cleared_at?: string | null
          created_at?: string
          created_by?: string | null
          credit_amount?: number
          currency?: string | null
          debit_amount?: number
          depot_id?: string | null
          description: string
          financial_account_id?: string | null
          fx_rate?: number | null
          gl_account_id?: string | null
          id?: string
          journal_id?: string | null
          organization_id?: string
          project_id?: string | null
          reconciliation_id?: string | null
          reference_id?: string | null
          reference_type?: string | null
          transaction_date?: string
          transaction_number: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          base_currency?: string | null
          category?: string
          cleared_at?: string | null
          created_at?: string
          created_by?: string | null
          credit_amount?: number
          currency?: string | null
          debit_amount?: number
          depot_id?: string | null
          description?: string
          financial_account_id?: string | null
          fx_rate?: number | null
          gl_account_id?: string | null
          id?: string
          journal_id?: string | null
          organization_id?: string
          project_id?: string | null
          reconciliation_id?: string | null
          reference_id?: string | null
          reference_type?: string | null
          transaction_date?: string
          transaction_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_transactions_financial_account_id_fkey"
            columns: ["financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "accounting_transactions_financial_account_id_fkey"
            columns: ["financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_transactions_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_transactions_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["gl_account_id"]
          },
          {
            foreignKeyName: "accounting_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "accounting_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "accounting_transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_transactions_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "bank_reconciliations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_findings: {
        Row: {
          ai_generated: boolean
          amount: number | null
          cleared_at: string | null
          created_at: string
          currency: string | null
          dedupe_key: string
          details: Json
          entity_id: string | null
          entity_label: string | null
          entity_table: string | null
          explanation: string | null
          finding_type: string
          first_seen_at: string
          id: string
          job: string
          last_seen_at: string
          occurrences: number
          organization_id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          severity: string
          status: string
          suggested_action: string | null
          title: string
          updated_at: string
        }
        Insert: {
          ai_generated?: boolean
          amount?: number | null
          cleared_at?: string | null
          created_at?: string
          currency?: string | null
          dedupe_key: string
          details?: Json
          entity_id?: string | null
          entity_label?: string | null
          entity_table?: string | null
          explanation?: string | null
          finding_type: string
          first_seen_at?: string
          id?: string
          job?: string
          last_seen_at?: string
          occurrences?: number
          organization_id: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: string
          status?: string
          suggested_action?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          ai_generated?: boolean
          amount?: number | null
          cleared_at?: string | null
          created_at?: string
          currency?: string | null
          dedupe_key?: string
          details?: Json
          entity_id?: string | null
          entity_label?: string | null
          entity_table?: string | null
          explanation?: string | null
          finding_type?: string
          first_seen_at?: string
          id?: string
          job?: string
          last_seen_at?: string
          occurrences?: number
          organization_id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: string
          status?: string
          suggested_action?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_job_state: {
        Row: {
          created_at: string
          id: string
          job: string
          last_error: string | null
          last_run_at: string | null
          last_run_findings: number
          lease_until: string | null
          locked_by: string | null
          organization_id: string
          pause_reason: string | null
          paused: boolean
          paused_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          job: string
          last_error?: string | null
          last_run_at?: string | null
          last_run_findings?: number
          lease_until?: string | null
          locked_by?: string | null
          organization_id: string
          pause_reason?: string | null
          paused?: boolean
          paused_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          job?: string
          last_error?: string | null
          last_run_at?: string | null
          last_run_findings?: number
          lease_until?: string | null
          locked_by?: string | null
          organization_id?: string
          pause_reason?: string | null
          paused?: boolean
          paused_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      approval_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          doc_id: string
          doc_type: string
          from_user: string | null
          id: string
          note: string | null
          organization_id: string
          request_id: string
          to_user: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          doc_id: string
          doc_type: string
          from_user?: string | null
          id?: string
          note?: string | null
          organization_id: string
          request_id: string
          to_user?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          doc_id?: string
          doc_type?: string
          from_user?: string | null
          id?: string
          note?: string | null
          organization_id?: string
          request_id?: string
          to_user?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_policies: {
        Row: {
          created_at: string
          document_type: string
          enabled: boolean
          id: string
          limited_roles: string[]
          min_amount: number
          organization_id: string
          required_role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_type: string
          enabled?: boolean
          id?: string
          limited_roles?: string[]
          min_amount?: number
          organization_id: string
          required_role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_type?: string
          enabled?: boolean
          id?: string
          limited_roles?: string[]
          min_amount?: number
          organization_id?: string
          required_role?: string
          updated_at?: string
        }
        Relationships: []
      }
      approval_requests: {
        Row: {
          amount: number | null
          assigned_to: string | null
          created_at: string
          current_step: number
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          doc_id: string
          doc_type: string
          id: string
          organization_id: string
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          assigned_to?: string | null
          created_at?: string
          current_step?: number
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          doc_id: string
          doc_type: string
          id?: string
          organization_id?: string
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          assigned_to?: string | null
          created_at?: string
          current_step?: number
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          doc_id?: string
          doc_type?: string
          id?: string
          organization_id?: string
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      approval_workflows: {
        Row: {
          approver_role: string
          created_at: string
          doc_type: string
          id: string
          is_active: boolean
          organization_id: string
          sequence: number
          threshold_amount: number
          updated_at: string
        }
        Insert: {
          approver_role?: string
          created_at?: string
          doc_type: string
          id?: string
          is_active?: boolean
          organization_id?: string
          sequence?: number
          threshold_amount?: number
          updated_at?: string
        }
        Update: {
          approver_role?: string
          created_at?: string
          doc_type?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          sequence?: number
          threshold_amount?: number
          updated_at?: string
        }
        Relationships: []
      }
      asset_assignments: {
        Row: {
          actor_user_id: string | null
          asset_id: string
          created_at: string
          effective_at: string
          from_depot_id: string | null
          from_employee_id: string | null
          id: string
          notes: string | null
          organization_id: string
          to_depot_id: string | null
          to_employee_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          asset_id: string
          created_at?: string
          effective_at?: string
          from_depot_id?: string | null
          from_employee_id?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          to_depot_id?: string | null
          to_employee_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          asset_id?: string
          created_at?: string
          effective_at?: string
          from_depot_id?: string | null
          from_employee_id?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          to_depot_id?: string | null
          to_employee_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_assignments_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_assignments_from_depot_id_fkey"
            columns: ["from_depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_assignments_from_employee_id_fkey"
            columns: ["from_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "asset_assignments_from_employee_id_fkey"
            columns: ["from_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_payroll_status"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "asset_assignments_from_employee_id_fkey"
            columns: ["from_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_assignments_to_depot_id_fkey"
            columns: ["to_depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_assignments_to_employee_id_fkey"
            columns: ["to_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "asset_assignments_to_employee_id_fkey"
            columns: ["to_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_payroll_status"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "asset_assignments_to_employee_id_fkey"
            columns: ["to_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_chargeback_payments: {
        Row: {
          amount: number
          created_at: string
          currency: string | null
          id: string
          issue_id: string
          method: string
          notes: string | null
          organization_id: string
          paid_at: string
          recorded_by: string | null
          reference: string | null
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string | null
          id?: string
          issue_id: string
          method?: string
          notes?: string | null
          organization_id: string
          paid_at?: string
          recorded_by?: string | null
          reference?: string | null
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string | null
          id?: string
          issue_id?: string
          method?: string
          notes?: string | null
          organization_id?: string
          paid_at?: string
          recorded_by?: string | null
          reference?: string | null
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_chargeback_payments_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "asset_issues"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_disposals: {
        Row: {
          approval_request_id: string | null
          asset_id: string
          buyer_customer_id: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          disposed_on: string
          gain_loss: number | null
          id: string
          method: Database["public"]["Enums"]["asset_disposal_method"]
          nbv_at_disposal: number | null
          notes: string | null
          organization_id: string
          posted_at: string | null
          proceeds: number
          status: string
          updated_at: string
        }
        Insert: {
          approval_request_id?: string | null
          asset_id: string
          buyer_customer_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          disposed_on?: string
          gain_loss?: number | null
          id?: string
          method: Database["public"]["Enums"]["asset_disposal_method"]
          nbv_at_disposal?: number | null
          notes?: string | null
          organization_id: string
          posted_at?: string | null
          proceeds?: number
          status?: string
          updated_at?: string
        }
        Update: {
          approval_request_id?: string | null
          asset_id?: string
          buyer_customer_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          disposed_on?: string
          gain_loss?: number | null
          id?: string
          method?: Database["public"]["Enums"]["asset_disposal_method"]
          nbv_at_disposal?: number | null
          notes?: string | null
          organization_id?: string
          posted_at?: string | null
          proceeds?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_disposals_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_disposals_buyer_customer_id_fkey"
            columns: ["buyer_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_issues: {
        Row: {
          asset_id: string
          charge_invoice_id: string | null
          charge_transaction_id: string | null
          chargeback_amount_paid: number
          chargeback_decided_at: string | null
          chargeback_decided_by: string | null
          chargeback_decision_notes: string | null
          chargeback_status: Database["public"]["Enums"]["asset_chargeback_status"]
          chargeback_submitted_at: string | null
          chargeback_submitted_by: string | null
          condition_in:
            | Database["public"]["Enums"]["asset_issue_condition"]
            | null
          condition_in_notes: string | null
          condition_out: Database["public"]["Enums"]["asset_issue_condition"]
          condition_out_notes: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          damage_charge_amount: number | null
          depot_id: string | null
          expected_return_at: string | null
          id: string
          issued_at: string
          issued_by_employee_id: string | null
          issued_to_customer_id: string | null
          issued_to_employee_id: string | null
          issued_to_name: string | null
          notes: string | null
          organization_id: string
          photos_in: Json
          photos_out: Json
          purpose: string | null
          received_by_employee_id: string | null
          returned_at: string | null
          status: Database["public"]["Enums"]["asset_issue_status"]
          updated_at: string
          work_order_id: string | null
        }
        Insert: {
          asset_id: string
          charge_invoice_id?: string | null
          charge_transaction_id?: string | null
          chargeback_amount_paid?: number
          chargeback_decided_at?: string | null
          chargeback_decided_by?: string | null
          chargeback_decision_notes?: string | null
          chargeback_status?: Database["public"]["Enums"]["asset_chargeback_status"]
          chargeback_submitted_at?: string | null
          chargeback_submitted_by?: string | null
          condition_in?:
            | Database["public"]["Enums"]["asset_issue_condition"]
            | null
          condition_in_notes?: string | null
          condition_out?: Database["public"]["Enums"]["asset_issue_condition"]
          condition_out_notes?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          damage_charge_amount?: number | null
          depot_id?: string | null
          expected_return_at?: string | null
          id?: string
          issued_at?: string
          issued_by_employee_id?: string | null
          issued_to_customer_id?: string | null
          issued_to_employee_id?: string | null
          issued_to_name?: string | null
          notes?: string | null
          organization_id?: string
          photos_in?: Json
          photos_out?: Json
          purpose?: string | null
          received_by_employee_id?: string | null
          returned_at?: string | null
          status?: Database["public"]["Enums"]["asset_issue_status"]
          updated_at?: string
          work_order_id?: string | null
        }
        Update: {
          asset_id?: string
          charge_invoice_id?: string | null
          charge_transaction_id?: string | null
          chargeback_amount_paid?: number
          chargeback_decided_at?: string | null
          chargeback_decided_by?: string | null
          chargeback_decision_notes?: string | null
          chargeback_status?: Database["public"]["Enums"]["asset_chargeback_status"]
          chargeback_submitted_at?: string | null
          chargeback_submitted_by?: string | null
          condition_in?:
            | Database["public"]["Enums"]["asset_issue_condition"]
            | null
          condition_in_notes?: string | null
          condition_out?: Database["public"]["Enums"]["asset_issue_condition"]
          condition_out_notes?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          damage_charge_amount?: number | null
          depot_id?: string | null
          expected_return_at?: string | null
          id?: string
          issued_at?: string
          issued_by_employee_id?: string | null
          issued_to_customer_id?: string | null
          issued_to_employee_id?: string | null
          issued_to_name?: string | null
          notes?: string | null
          organization_id?: string
          photos_in?: Json
          photos_out?: Json
          purpose?: string | null
          received_by_employee_id?: string | null
          returned_at?: string | null
          status?: Database["public"]["Enums"]["asset_issue_status"]
          updated_at?: string
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_issues_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_issues_charge_invoice_id_fkey"
            columns: ["charge_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_issues_charge_transaction_id_fkey"
            columns: ["charge_transaction_id"]
            isOneToOne: false
            referencedRelation: "accounting_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_issues_charge_transaction_id_fkey"
            columns: ["charge_transaction_id"]
            isOneToOne: false
            referencedRelation: "currency_integrity_exceptions"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "asset_issues_charge_transaction_id_fkey"
            columns: ["charge_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_expense_journal_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_issues_depot_id_fkey"
            columns: ["depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_issues_issued_by_employee_id_fkey"
            columns: ["issued_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "asset_issues_issued_by_employee_id_fkey"
            columns: ["issued_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_payroll_status"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "asset_issues_issued_by_employee_id_fkey"
            columns: ["issued_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_issues_issued_to_customer_id_fkey"
            columns: ["issued_to_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_issues_issued_to_employee_id_fkey"
            columns: ["issued_to_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "asset_issues_issued_to_employee_id_fkey"
            columns: ["issued_to_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_payroll_status"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "asset_issues_issued_to_employee_id_fkey"
            columns: ["issued_to_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_issues_received_by_employee_id_fkey"
            columns: ["received_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "asset_issues_received_by_employee_id_fkey"
            columns: ["received_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_payroll_status"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "asset_issues_received_by_employee_id_fkey"
            columns: ["received_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_issues_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_maintenance_plans: {
        Row: {
          asset_id: string
          created_at: string
          frequency: string
          id: string
          interval_days: number | null
          is_active: boolean
          last_done_at: string | null
          name: string
          next_due_at: string
          organization_id: string
          task_template: string | null
          updated_at: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          frequency: string
          id?: string
          interval_days?: number | null
          is_active?: boolean
          last_done_at?: string | null
          name: string
          next_due_at: string
          organization_id: string
          task_template?: string | null
          updated_at?: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          frequency?: string
          id?: string
          interval_days?: number | null
          is_active?: boolean
          last_done_at?: string | null
          name?: string
          next_due_at?: string
          organization_id?: string
          task_template?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_maintenance_plans_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_audit: {
        Row: {
          action: string
          actor: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          line_id: string | null
          organization_id: string
          reason: string | null
          week_id: string
        }
        Insert: {
          action: string
          actor?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          line_id?: string | null
          organization_id: string
          reason?: string | null
          week_id: string
        }
        Update: {
          action?: string
          actor?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          line_id?: string | null
          organization_id?: string
          reason?: string | null
          week_id?: string
        }
        Relationships: []
      }
      attendance_lines: {
        Row: {
          allowance: number
          allowance_label: string | null
          amount: number
          base_amount: number
          basis: string
          conversion_id: string | null
          correction_reason: string | null
          created_at: string
          days: number
          employee_id: string
          holiday_amount: number
          hours: number
          id: string
          is_correction: boolean
          notes: string | null
          organization_id: string
          overtime_amount: number
          overtime_hours: number
          payslip_id: string | null
          project_id: string | null
          rate: number
          reverses_line_id: string | null
          week_id: string
          work_date: string | null
        }
        Insert: {
          allowance?: number
          allowance_label?: string | null
          amount?: number
          base_amount?: number
          basis?: string
          conversion_id?: string | null
          correction_reason?: string | null
          created_at?: string
          days?: number
          employee_id: string
          holiday_amount?: number
          hours?: number
          id?: string
          is_correction?: boolean
          notes?: string | null
          organization_id?: string
          overtime_amount?: number
          overtime_hours?: number
          payslip_id?: string | null
          project_id?: string | null
          rate?: number
          reverses_line_id?: string | null
          week_id: string
          work_date?: string | null
        }
        Update: {
          allowance?: number
          allowance_label?: string | null
          amount?: number
          base_amount?: number
          basis?: string
          conversion_id?: string | null
          correction_reason?: string | null
          created_at?: string
          days?: number
          employee_id?: string
          holiday_amount?: number
          hours?: number
          id?: string
          is_correction?: boolean
          notes?: string | null
          organization_id?: string
          overtime_amount?: number
          overtime_hours?: number
          payslip_id?: string | null
          project_id?: string | null
          rate?: number
          reverses_line_id?: string | null
          week_id?: string
          work_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_lines_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_lines_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "attendance_lines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "attendance_lines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_payroll_status"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "attendance_lines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_lines_payslip_id_fkey"
            columns: ["payslip_id"]
            isOneToOne: false
            referencedRelation: "payslips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "attendance_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_lines_reverses_line_id_fkey"
            columns: ["reverses_line_id"]
            isOneToOne: false
            referencedRelation: "attendance_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_lines_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "attendance_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_weeks: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          deduction_amount: number
          gross_amount: number
          id: string
          net_amount: number
          notes: string | null
          organization_id: string
          paid_at: string | null
          paid_by: string | null
          paid_from_account_id: string | null
          status: string
          total_amount: number
          week_end: string
          week_start: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          deduction_amount?: number
          gross_amount?: number
          id?: string
          net_amount?: number
          notes?: string | null
          organization_id?: string
          paid_at?: string | null
          paid_by?: string | null
          paid_from_account_id?: string | null
          status?: string
          total_amount?: number
          week_end: string
          week_start: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          deduction_amount?: number
          gross_amount?: number
          id?: string
          net_amount?: number
          notes?: string | null
          organization_id?: string
          paid_at?: string | null
          paid_by?: string | null
          paid_from_account_id?: string | null
          status?: string
          total_amount?: number
          week_end?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_weeks_paid_from_account_id_fkey"
            columns: ["paid_from_account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "attendance_weeks_paid_from_account_id_fkey"
            columns: ["paid_from_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_reconciliation_lines: {
        Row: {
          cleared: boolean
          created_at: string
          excluded: boolean
          id: string
          notes: string | null
          organization_id: string
          override_reason: string | null
          reconciliation_id: string
          resolved_at: string | null
          resolved_by: string | null
          statement_ref: string | null
          transaction_id: string
        }
        Insert: {
          cleared?: boolean
          created_at?: string
          excluded?: boolean
          id?: string
          notes?: string | null
          organization_id?: string
          override_reason?: string | null
          reconciliation_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          statement_ref?: string | null
          transaction_id: string
        }
        Update: {
          cleared?: boolean
          created_at?: string
          excluded?: boolean
          id?: string
          notes?: string | null
          organization_id?: string
          override_reason?: string | null
          reconciliation_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          statement_ref?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_reconciliation_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "bank_reconciliation_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_reconciliation_lines_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "bank_reconciliations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_reconciliation_lines_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "accounting_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_reconciliation_lines_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "currency_integrity_exceptions"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "bank_reconciliation_lines_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_expense_journal_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_reconciliations: {
        Row: {
          account_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          organization_id: string
          statement_closing_balance: number
          statement_end: string
          statement_opening_balance: number
          statement_start: string
          status: Database["public"]["Enums"]["bank_reconciliation_status"]
          updated_at: string
        }
        Insert: {
          account_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          statement_closing_balance?: number
          statement_end: string
          statement_opening_balance?: number
          statement_start: string
          status?: Database["public"]["Enums"]["bank_reconciliation_status"]
          updated_at?: string
        }
        Update: {
          account_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          statement_closing_balance?: number
          statement_end?: string
          statement_opening_balance?: number
          statement_start?: string
          status?: Database["public"]["Enums"]["bank_reconciliation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_reconciliations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "bank_reconciliations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_reconciliations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "bank_reconciliations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_imports: {
        Row: {
          account_id: string
          created_at: string
          credit_amount: number
          debit_amount: number
          description: string | null
          id: string
          matched_transaction_id: string | null
          organization_id: string
          reconciliation_id: string | null
          reference: string | null
          txn_date: string
        }
        Insert: {
          account_id: string
          created_at?: string
          credit_amount?: number
          debit_amount?: number
          description?: string | null
          id?: string
          matched_transaction_id?: string | null
          organization_id?: string
          reconciliation_id?: string | null
          reference?: string | null
          txn_date: string
        }
        Update: {
          account_id?: string
          created_at?: string
          credit_amount?: number
          debit_amount?: number
          description?: string | null
          id?: string
          matched_transaction_id?: string | null
          organization_id?: string
          reconciliation_id?: string | null
          reference?: string | null
          txn_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_imports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "bank_statement_imports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_imports_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "accounting_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_imports_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "currency_integrity_exceptions"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "bank_statement_imports_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_expense_journal_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "bank_statement_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_imports_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "bank_reconciliations"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          amount: number
          category_id: string | null
          created_at: string
          depot_id: string | null
          gl_account_id: string
          id: string
          notes: string | null
          organization_id: string
          period_id: string
          project_id: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          category_id?: string | null
          created_at?: string
          depot_id?: string | null
          gl_account_id: string
          id?: string
          notes?: string | null
          organization_id?: string
          period_id: string
          project_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          category_id?: string | null
          created_at?: string
          depot_id?: string | null
          gl_account_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          period_id?: string
          project_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_depot_id_fkey"
            columns: ["depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["gl_account_id"]
          },
          {
            foreignKeyName: "budgets_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "fiscal_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      container_conversions: {
        Row: {
          actual_cost: number | null
          assembly_type: Database["public"]["Enums"]["assembly_type"] | null
          budget_amount: number
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          container_cost: number | null
          container_id: string | null
          conversion_number: string
          created_at: string
          created_by: string | null
          currency: string | null
          customer_id: string | null
          description: string | null
          end_date: string | null
          estimated_cost: number | null
          id: string
          job_kind: Database["public"]["Enums"]["conversion_job_kind"]
          organization_id: string
          product_type: Database["public"]["Enums"]["conversion_product_type"]
          project_id: string | null
          qty_produced: number
          quote_id: string | null
          quoted_price: number | null
          sales_order_id: string | null
          specifications: Json | null
          start_date: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["conversion_status"]
          supplier_invoice_id: string | null
          transport_offloading_cost: number
          unit_cost: number
          unit_of_measure: string | null
          updated_at: string
        }
        Insert: {
          actual_cost?: number | null
          assembly_type?: Database["public"]["Enums"]["assembly_type"] | null
          budget_amount?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          container_cost?: number | null
          container_id?: string | null
          conversion_number: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customer_id?: string | null
          description?: string | null
          end_date?: string | null
          estimated_cost?: number | null
          id?: string
          job_kind?: Database["public"]["Enums"]["conversion_job_kind"]
          organization_id?: string
          product_type?: Database["public"]["Enums"]["conversion_product_type"]
          project_id?: string | null
          qty_produced?: number
          quote_id?: string | null
          quoted_price?: number | null
          sales_order_id?: string | null
          specifications?: Json | null
          start_date?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["conversion_status"]
          supplier_invoice_id?: string | null
          transport_offloading_cost?: number
          unit_cost?: number
          unit_of_measure?: string | null
          updated_at?: string
        }
        Update: {
          actual_cost?: number | null
          assembly_type?: Database["public"]["Enums"]["assembly_type"] | null
          budget_amount?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          container_cost?: number | null
          container_id?: string | null
          conversion_number?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customer_id?: string | null
          description?: string | null
          end_date?: string | null
          estimated_cost?: number | null
          id?: string
          job_kind?: Database["public"]["Enums"]["conversion_job_kind"]
          organization_id?: string
          product_type?: Database["public"]["Enums"]["conversion_product_type"]
          project_id?: string | null
          qty_produced?: number
          quote_id?: string | null
          quoted_price?: number | null
          sales_order_id?: string | null
          specifications?: Json | null
          start_date?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["conversion_status"]
          supplier_invoice_id?: string | null
          transport_offloading_cost?: number
          unit_cost?: number
          unit_of_measure?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "container_conversions_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_conversions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_conversions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "container_conversions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_conversions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "container_conversions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_conversions_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_conversions_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_conversions_supplier_invoice_id_fkey"
            columns: ["supplier_invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      container_movements: {
        Row: {
          container_id: string
          created_at: string
          from_bay: number | null
          from_block_id: string | null
          from_row: number | null
          from_tier: number | null
          id: string
          movement_type: Database["public"]["Enums"]["movement_type"]
          notes: string | null
          organization_id: string
          performed_by: string | null
          to_bay: number | null
          to_block_id: string | null
          to_row: number | null
          to_tier: number | null
        }
        Insert: {
          container_id: string
          created_at?: string
          from_bay?: number | null
          from_block_id?: string | null
          from_row?: number | null
          from_tier?: number | null
          id?: string
          movement_type: Database["public"]["Enums"]["movement_type"]
          notes?: string | null
          organization_id?: string
          performed_by?: string | null
          to_bay?: number | null
          to_block_id?: string | null
          to_row?: number | null
          to_tier?: number | null
        }
        Update: {
          container_id?: string
          created_at?: string
          from_bay?: number | null
          from_block_id?: string | null
          from_row?: number | null
          from_tier?: number | null
          id?: string
          movement_type?: Database["public"]["Enums"]["movement_type"]
          notes?: string | null
          organization_id?: string
          performed_by?: string | null
          to_bay?: number | null
          to_block_id?: string | null
          to_row?: number | null
          to_tier?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "container_movements_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_movements_from_block_id_fkey"
            columns: ["from_block_id"]
            isOneToOne: false
            referencedRelation: "yard_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "container_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_movements_to_block_id_fkey"
            columns: ["to_block_id"]
            isOneToOne: false
            referencedRelation: "yard_blocks"
            referencedColumns: ["id"]
          },
        ]
      }
      container_sales: {
        Row: {
          acquisition_supplier: string | null
          buyer_contact: string | null
          buyer_name: string
          container_id: string | null
          conversion_id: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          customer_id: string | null
          eir_id: string | null
          entry_price: number
          id: string
          invoice_id: string | null
          markup_percentage: number
          notes: string | null
          organization_id: string
          original_owner: string | null
          purchase_invoice_id: string | null
          quote_id: string | null
          sale_number: string
          selling_price: number
          sold_at: string | null
          status: Database["public"]["Enums"]["sale_status"]
          supplier_invoice_id: string | null
          transport_offloading_cost: number
          updated_at: string
        }
        Insert: {
          acquisition_supplier?: string | null
          buyer_contact?: string | null
          buyer_name: string
          container_id?: string | null
          conversion_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customer_id?: string | null
          eir_id?: string | null
          entry_price?: number
          id?: string
          invoice_id?: string | null
          markup_percentage?: number
          notes?: string | null
          organization_id?: string
          original_owner?: string | null
          purchase_invoice_id?: string | null
          quote_id?: string | null
          sale_number: string
          selling_price?: number
          sold_at?: string | null
          status?: Database["public"]["Enums"]["sale_status"]
          supplier_invoice_id?: string | null
          transport_offloading_cost?: number
          updated_at?: string
        }
        Update: {
          acquisition_supplier?: string | null
          buyer_contact?: string | null
          buyer_name?: string
          container_id?: string | null
          conversion_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customer_id?: string | null
          eir_id?: string | null
          entry_price?: number
          id?: string
          invoice_id?: string | null
          markup_percentage?: number
          notes?: string | null
          organization_id?: string
          original_owner?: string | null
          purchase_invoice_id?: string | null
          quote_id?: string | null
          sale_number?: string
          selling_price?: number
          sold_at?: string | null
          status?: Database["public"]["Enums"]["sale_status"]
          supplier_invoice_id?: string | null
          transport_offloading_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "container_sales_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_sales_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_sales_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "container_sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_sales_eir_id_fkey"
            columns: ["eir_id"]
            isOneToOne: false
            referencedRelation: "eir_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_sales_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_sales_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "container_sales_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_sales_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_sales_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_vat_summary"
            referencedColumns: ["purchase_order_id"]
          },
          {
            foreignKeyName: "container_sales_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_sales_supplier_invoice_id_fkey"
            columns: ["supplier_invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      containers: {
        Row: {
          acquisition_cost: number
          acquisition_currency: string | null
          bay: number | null
          block_id: string | null
          category: Database["public"]["Enums"]["container_category"]
          container_number: string
          created_at: string
          customer_id: string | null
          depot_id: string | null
          driver_id_number: string | null
          driver_name: string | null
          driver_phone: string | null
          gate_in_at: string | null
          gate_out_at: string | null
          hazard_class: string | null
          height_class:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id: string
          imo_class: string | null
          is_empty: boolean
          iso_type: string | null
          notes: string | null
          offloading_cost: number
          offloading_currency: string | null
          offloading_vendor: string | null
          organization_id: string
          owner: string | null
          ownership_type: string
          parent_container_id: string | null
          pickup_depot_id: string | null
          pickup_location: string | null
          row: number | null
          shipping_line: string | null
          size: Database["public"]["Enums"]["container_size"]
          status: Database["public"]["Enums"]["container_status"]
          tare_weight_kg: number | null
          tier: number | null
          transport_cost: number
          transport_currency: string | null
          transport_vendor: string | null
          transporter: string | null
          truck_registration: string | null
          updated_at: string
          weight_kg: number | null
        }
        Insert: {
          acquisition_cost?: number
          acquisition_currency?: string | null
          bay?: number | null
          block_id?: string | null
          category?: Database["public"]["Enums"]["container_category"]
          container_number: string
          created_at?: string
          customer_id?: string | null
          depot_id?: string | null
          driver_id_number?: string | null
          driver_name?: string | null
          driver_phone?: string | null
          gate_in_at?: string | null
          gate_out_at?: string | null
          hazard_class?: string | null
          height_class?:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id?: string
          imo_class?: string | null
          is_empty?: boolean
          iso_type?: string | null
          notes?: string | null
          offloading_cost?: number
          offloading_currency?: string | null
          offloading_vendor?: string | null
          organization_id?: string
          owner?: string | null
          ownership_type?: string
          parent_container_id?: string | null
          pickup_depot_id?: string | null
          pickup_location?: string | null
          row?: number | null
          shipping_line?: string | null
          size?: Database["public"]["Enums"]["container_size"]
          status?: Database["public"]["Enums"]["container_status"]
          tare_weight_kg?: number | null
          tier?: number | null
          transport_cost?: number
          transport_currency?: string | null
          transport_vendor?: string | null
          transporter?: string | null
          truck_registration?: string | null
          updated_at?: string
          weight_kg?: number | null
        }
        Update: {
          acquisition_cost?: number
          acquisition_currency?: string | null
          bay?: number | null
          block_id?: string | null
          category?: Database["public"]["Enums"]["container_category"]
          container_number?: string
          created_at?: string
          customer_id?: string | null
          depot_id?: string | null
          driver_id_number?: string | null
          driver_name?: string | null
          driver_phone?: string | null
          gate_in_at?: string | null
          gate_out_at?: string | null
          hazard_class?: string | null
          height_class?:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id?: string
          imo_class?: string | null
          is_empty?: boolean
          iso_type?: string | null
          notes?: string | null
          offloading_cost?: number
          offloading_currency?: string | null
          offloading_vendor?: string | null
          organization_id?: string
          owner?: string | null
          ownership_type?: string
          parent_container_id?: string | null
          pickup_depot_id?: string | null
          pickup_location?: string | null
          row?: number | null
          shipping_line?: string | null
          size?: Database["public"]["Enums"]["container_size"]
          status?: Database["public"]["Enums"]["container_status"]
          tare_weight_kg?: number | null
          tier?: number | null
          transport_cost?: number
          transport_currency?: string | null
          transport_vendor?: string | null
          transporter?: string | null
          truck_registration?: string | null
          updated_at?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "containers_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "yard_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "containers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "containers_depot_id_fkey"
            columns: ["depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "containers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "containers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "containers_parent_container_id_fkey"
            columns: ["parent_container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "containers_pickup_depot_id_fkey"
            columns: ["pickup_depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
        ]
      }
      contra_settlement_lines: {
        Row: {
          amount: number
          created_at: string
          document_number: string | null
          id: string
          invoice_id: string | null
          organization_id: string
          settlement_id: string
          side: string
          supplier_invoice_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          document_number?: string | null
          id?: string
          invoice_id?: string | null
          organization_id?: string
          settlement_id: string
          side: string
          supplier_invoice_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          document_number?: string | null
          id?: string
          invoice_id?: string | null
          organization_id?: string
          settlement_id?: string
          side?: string
          supplier_invoice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contra_settlement_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contra_settlement_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "contra_settlement_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contra_settlement_lines_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "contra_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contra_settlement_lines_supplier_invoice_id_fkey"
            columns: ["supplier_invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      contra_settlements: {
        Row: {
          amount: number
          ap_payment_id: string | null
          approval_request_id: string | null
          ar_payment_ids: string[]
          bank_charge_amount: number
          bank_charge_expense_id: string | null
          cash_amount: number
          cash_fx_rate: number | null
          cash_payment_id: string | null
          counterparty_name: string
          created_at: string
          created_by: string | null
          currency: string
          customer_id: string | null
          evidence_ref: string | null
          id: string
          notes: string | null
          organization_id: string
          policy_snapshot: Json | null
          reversal_of: string | null
          settled_on: string
          settlement_account_id: string | null
          settlement_number: string
          status: string
          supplier_id: string
        }
        Insert: {
          amount: number
          ap_payment_id?: string | null
          approval_request_id?: string | null
          ar_payment_ids?: string[]
          bank_charge_amount?: number
          bank_charge_expense_id?: string | null
          cash_amount?: number
          cash_fx_rate?: number | null
          cash_payment_id?: string | null
          counterparty_name: string
          created_at?: string
          created_by?: string | null
          currency: string
          customer_id?: string | null
          evidence_ref?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          policy_snapshot?: Json | null
          reversal_of?: string | null
          settled_on?: string
          settlement_account_id?: string | null
          settlement_number: string
          status?: string
          supplier_id: string
        }
        Update: {
          amount?: number
          ap_payment_id?: string | null
          approval_request_id?: string | null
          ar_payment_ids?: string[]
          bank_charge_amount?: number
          bank_charge_expense_id?: string | null
          cash_amount?: number
          cash_fx_rate?: number | null
          cash_payment_id?: string | null
          counterparty_name?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
          evidence_ref?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          policy_snapshot?: Json | null
          reversal_of?: string | null
          settled_on?: string
          settlement_account_id?: string | null
          settlement_number?: string
          status?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contra_settlements_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contra_settlements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "contra_settlements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contra_settlements_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "contra_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contra_settlements_settlement_account_id_fkey"
            columns: ["settlement_account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "contra_settlements_settlement_account_id_fkey"
            columns: ["settlement_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contra_settlements_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_budget_lines: {
        Row: {
          conversion_id: string
          created_at: string
          created_by: string | null
          description: string
          est_total: number | null
          est_unit_cost: number
          id: string
          material_id: string | null
          organization_id: string
          planned_qty: number
          source: string
          updated_at: string
        }
        Insert: {
          conversion_id: string
          created_at?: string
          created_by?: string | null
          description: string
          est_total?: number | null
          est_unit_cost?: number
          id?: string
          material_id?: string | null
          organization_id?: string
          planned_qty?: number
          source?: string
          updated_at?: string
        }
        Update: {
          conversion_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          est_total?: number | null
          est_unit_cost?: number
          id?: string
          material_id?: string | null
          organization_id?: string
          planned_qty?: number
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversion_budget_lines_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_budget_lines_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "conversion_budget_lines_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "material_stock_reconciliation"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "conversion_budget_lines_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_container_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          conversion_id: string
          id: string
          new_container_cost: number | null
          new_container_id: string | null
          new_transport_offloading_cost: number | null
          old_container_cost: number | null
          old_container_id: string | null
          old_transport_offloading_cost: number | null
          organization_id: string | null
          reason: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          conversion_id: string
          id?: string
          new_container_cost?: number | null
          new_container_id?: string | null
          new_transport_offloading_cost?: number | null
          old_container_cost?: number | null
          old_container_id?: string | null
          old_transport_offloading_cost?: number | null
          organization_id?: string | null
          reason: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          conversion_id?: string
          id?: string
          new_container_cost?: number | null
          new_container_id?: string | null
          new_transport_offloading_cost?: number | null
          old_container_cost?: number | null
          old_container_id?: string | null
          old_transport_offloading_cost?: number | null
          organization_id?: string | null
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversion_container_audit_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_container_audit_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "conversion_container_audit_new_container_id_fkey"
            columns: ["new_container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_container_audit_old_container_id_fkey"
            columns: ["old_container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_containers: {
        Row: {
          container_cost: number
          container_id: string
          conversion_id: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          role: string
          transport_offloading_cost: number
        }
        Insert: {
          container_cost?: number
          container_id: string
          conversion_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          role?: string
          transport_offloading_cost?: number
        }
        Update: {
          container_cost?: number
          container_id?: string
          conversion_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          role?: string
          transport_offloading_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversion_containers_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_containers_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_containers_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
        ]
      }
      conversion_labour: {
        Row: {
          attendance_line_id: string | null
          conversion_id: string
          created_at: string
          hours: number
          id: string
          organization_id: string
          rate: number
          role: string | null
          source: string
          total_cost: number
          worker_name: string
        }
        Insert: {
          attendance_line_id?: string | null
          conversion_id: string
          created_at?: string
          hours?: number
          id?: string
          organization_id?: string
          rate?: number
          role?: string | null
          source?: string
          total_cost?: number
          worker_name: string
        }
        Update: {
          attendance_line_id?: string | null
          conversion_id?: string
          created_at?: string
          hours?: number
          id?: string
          organization_id?: string
          rate?: number
          role?: string | null
          source?: string
          total_cost?: number
          worker_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversion_labour_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_labour_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "conversion_labour_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "conversion_labour_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_material_audit: {
        Row: {
          conversion_id: string | null
          conversion_material_id: string | null
          created_at: string
          created_by: string | null
          event: string
          field_changed: string | null
          id: string
          material_id: string | null
          new_value: string | null
          note: string | null
          old_value: string | null
          organization_id: string | null
          qty: number | null
          reason: string | null
          unit_cost: number | null
        }
        Insert: {
          conversion_id?: string | null
          conversion_material_id?: string | null
          created_at?: string
          created_by?: string | null
          event: string
          field_changed?: string | null
          id?: string
          material_id?: string | null
          new_value?: string | null
          note?: string | null
          old_value?: string | null
          organization_id?: string | null
          qty?: number | null
          reason?: string | null
          unit_cost?: number | null
        }
        Update: {
          conversion_id?: string | null
          conversion_material_id?: string | null
          created_at?: string
          created_by?: string | null
          event?: string
          field_changed?: string | null
          id?: string
          material_id?: string | null
          new_value?: string | null
          note?: string | null
          old_value?: string | null
          organization_id?: string | null
          qty?: number | null
          reason?: string | null
          unit_cost?: number | null
        }
        Relationships: []
      }
      conversion_materials: {
        Row: {
          conversion_id: string
          created_at: string
          description: string
          id: string
          material_id: string | null
          organization_id: string
          qty_planned: number | null
          qty_used: number | null
          quantity: number
          source: string | null
          supplier: string | null
          total_cost: number
          unit_cost: number
        }
        Insert: {
          conversion_id: string
          created_at?: string
          description: string
          id?: string
          material_id?: string | null
          organization_id?: string
          qty_planned?: number | null
          qty_used?: number | null
          quantity?: number
          source?: string | null
          supplier?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Update: {
          conversion_id?: string
          created_at?: string
          description?: string
          id?: string
          material_id?: string | null
          organization_id?: string
          qty_planned?: number | null
          qty_used?: number | null
          quantity?: number
          source?: string | null
          supplier?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversion_materials_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_materials_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "conversion_materials_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "material_stock_reconciliation"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "conversion_materials_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_materials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "conversion_materials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_number_sequences: {
        Row: {
          last_seq: number
          organization_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          last_seq?: number
          organization_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          last_seq?: number
          organization_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversion_output_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          conversion_id: string
          id: string
          new_values: Json | null
          old_values: Json | null
          organization_id: string
          reason: string
          target_id: string | null
          target_kind: string
          target_label: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          conversion_id: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          organization_id: string
          reason: string
          target_id?: string | null
          target_kind: string
          target_label?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          conversion_id?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          organization_id?: string
          reason?: string
          target_id?: string | null
          target_kind?: string
          target_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversion_output_audit_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_output_audit_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
        ]
      }
      conversion_output_costs: {
        Row: {
          allocation_basis: string
          container_cost: number
          conversion_id: string
          created_at: string
          created_by: string | null
          id: string
          labour_cost: number
          materials_cost: number
          organization_id: string | null
          output_id: string
          output_kind: string
          services_cost: number
          snapshot: Json
          sub_assemblies_cost: number
          total_cost: number
        }
        Insert: {
          allocation_basis?: string
          container_cost?: number
          conversion_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          labour_cost?: number
          materials_cost?: number
          organization_id?: string | null
          output_id: string
          output_kind: string
          services_cost?: number
          snapshot?: Json
          sub_assemblies_cost?: number
          total_cost?: number
        }
        Update: {
          allocation_basis?: string
          container_cost?: number
          conversion_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          labour_cost?: number
          materials_cost?: number
          organization_id?: string | null
          output_id?: string
          output_kind?: string
          services_cost?: number
          snapshot?: Json
          sub_assemblies_cost?: number
          total_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversion_output_costs_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_output_costs_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
        ]
      }
      conversion_outputs: {
        Row: {
          category: Database["public"]["Enums"]["container_category"]
          conversion_id: string
          created_at: string
          height_class:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id: string
          notes: string | null
          number_prefix: string | null
          organization_id: string
          planned_count: number
          size: Database["public"]["Enums"]["container_size"]
          target_owner: string | null
        }
        Insert: {
          category: Database["public"]["Enums"]["container_category"]
          conversion_id: string
          created_at?: string
          height_class?:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id?: string
          notes?: string | null
          number_prefix?: string | null
          organization_id?: string
          planned_count?: number
          size: Database["public"]["Enums"]["container_size"]
          target_owner?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["container_category"]
          conversion_id?: string
          created_at?: string
          height_class?:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id?: string
          notes?: string | null
          number_prefix?: string | null
          organization_id?: string
          planned_count?: number
          size?: Database["public"]["Enums"]["container_size"]
          target_owner?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversion_outputs_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_outputs_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
        ]
      }
      conversion_revenue_audit: {
        Row: {
          changed_at: string
          changed_by: string | null
          conversion_id: string
          currency: string | null
          id: string
          new_amount: number
          old_amount: number
          organization_id: string
          reason: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          conversion_id: string
          currency?: string | null
          id?: string
          new_amount?: number
          old_amount?: number
          organization_id: string
          reason: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          conversion_id?: string
          currency?: string | null
          id?: string
          new_amount?: number
          old_amount?: number
          organization_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversion_revenue_audit_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_revenue_audit_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
        ]
      }
      conversion_services: {
        Row: {
          conversion_id: string
          cost: number
          created_at: string
          description: string | null
          id: string
          organization_id: string
          service_type: string
        }
        Insert: {
          conversion_id: string
          cost?: number
          created_at?: string
          description?: string | null
          id?: string
          organization_id?: string
          service_type?: string
        }
        Update: {
          conversion_id?: string
          cost?: number
          created_at?: string
          description?: string | null
          id?: string
          organization_id?: string
          service_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversion_services_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_services_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "conversion_services_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "conversion_services_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_sub_assemblies: {
        Row: {
          assembly_stock_id: string
          conversion_id: string
          created_at: string
          id: string
          organization_id: string
          qty_planned: number
          qty_used: number
          total_cost: number
          unit_cost_snapshot: number
          updated_at: string
        }
        Insert: {
          assembly_stock_id: string
          conversion_id: string
          created_at?: string
          id?: string
          organization_id?: string
          qty_planned?: number
          qty_used?: number
          total_cost?: number
          unit_cost_snapshot?: number
          updated_at?: string
        }
        Update: {
          assembly_stock_id?: string
          conversion_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          qty_planned?: number
          qty_used?: number
          total_cost?: number
          unit_cost_snapshot?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversion_sub_assemblies_assembly_stock_id_fkey"
            columns: ["assembly_stock_id"]
            isOneToOne: false
            referencedRelation: "sub_assembly_stock"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_sub_assemblies_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_sub_assemblies_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
        ]
      }
      conversion_tasks: {
        Row: {
          assigned_to: string | null
          conversion_id: string
          created_at: string
          end_time: string | null
          id: string
          organization_id: string
          start_time: string | null
          status: string
          task_name: string
        }
        Insert: {
          assigned_to?: string | null
          conversion_id: string
          created_at?: string
          end_time?: string | null
          id?: string
          organization_id?: string
          start_time?: string | null
          status?: string
          task_name: string
        }
        Update: {
          assigned_to?: string | null
          conversion_id?: string
          created_at?: string
          end_time?: string | null
          id?: string
          organization_id?: string
          start_time?: string | null
          status?: string
          task_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversion_tasks_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_tasks_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "conversion_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "conversion_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_entries: {
        Row: {
          amount: number
          cost_type: string
          created_at: string
          description: string | null
          id: string
          organization_id: string
          production_order_id: string
          reference_id: string | null
          reference_type: string | null
        }
        Insert: {
          amount?: number
          cost_type?: string
          created_at?: string
          description?: string | null
          id?: string
          organization_id?: string
          production_order_id: string
          reference_id?: string | null
          reference_type?: string | null
        }
        Update: {
          amount?: number
          cost_type?: string
          created_at?: string
          description?: string | null
          id?: string
          organization_id?: string
          production_order_id?: string
          reference_id?: string | null
          reference_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "cost_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_entries_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_entries_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
        ]
      }
      currency_minor_units: {
        Row: {
          code: string
          digits: number
        }
        Insert: {
          code: string
          digits?: number
        }
        Update: {
          code?: string
          digits?: number
        }
        Relationships: []
      }
      customer_portal_users: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          is_active: boolean
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          is_active?: boolean
          organization_id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_portal_users_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_portal_users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "customer_portal_users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          company_name: string
          contact_person: string | null
          created_at: string
          created_by: string | null
          currency: string
          customer_type: Database["public"]["Enums"]["customer_type"]
          email: string | null
          id: string
          is_active: boolean
          kra_pin: string | null
          linked_supplier_id: string | null
          logistics_billing_cycle:
            | Database["public"]["Enums"]["logistics_billing_cycle"]
            | null
          logistics_billing_mode:
            | Database["public"]["Enums"]["logistics_billing_mode"]
            | null
          notes: string | null
          organization_id: string
          phone: string | null
          tax_id: string | null
          updated_at: string
          whatsapp_number: string | null
        }
        Insert: {
          address?: string | null
          company_name: string
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          currency: string
          customer_type: Database["public"]["Enums"]["customer_type"]
          email?: string | null
          id?: string
          is_active?: boolean
          kra_pin?: string | null
          linked_supplier_id?: string | null
          logistics_billing_cycle?:
            | Database["public"]["Enums"]["logistics_billing_cycle"]
            | null
          logistics_billing_mode?:
            | Database["public"]["Enums"]["logistics_billing_mode"]
            | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
          whatsapp_number?: string | null
        }
        Update: {
          address?: string | null
          company_name?: string
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          email?: string | null
          id?: string
          is_active?: boolean
          kra_pin?: string | null
          linked_supplier_id?: string | null
          logistics_billing_cycle?:
            | Database["public"]["Enums"]["logistics_billing_cycle"]
            | null
          logistics_billing_mode?:
            | Database["public"]["Enums"]["logistics_billing_mode"]
            | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_linked_supplier_id_fkey"
            columns: ["linked_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      damage_estimates: {
        Row: {
          approval_status: Database["public"]["Enums"]["approval_status"]
          approved_at: string | null
          approved_by: string | null
          container_id: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          description: string
          estimate_number: string
          id: string
          inspection_id: string | null
          labor_cost: number | null
          labor_hours: number | null
          material_cost: number | null
          organization_id: string
          rejection_reason: string | null
          repair_type: Database["public"]["Enums"]["repair_type"]
          total_cost: number | null
          updated_at: string
        }
        Insert: {
          approval_status?: Database["public"]["Enums"]["approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          container_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          description: string
          estimate_number: string
          id?: string
          inspection_id?: string | null
          labor_cost?: number | null
          labor_hours?: number | null
          material_cost?: number | null
          organization_id?: string
          rejection_reason?: string | null
          repair_type?: Database["public"]["Enums"]["repair_type"]
          total_cost?: number | null
          updated_at?: string
        }
        Update: {
          approval_status?: Database["public"]["Enums"]["approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          container_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          description?: string
          estimate_number?: string
          id?: string
          inspection_id?: string | null
          labor_cost?: number | null
          labor_hours?: number | null
          material_cost?: number | null
          organization_id?: string
          rejection_reason?: string | null
          repair_type?: Database["public"]["Enums"]["repair_type"]
          total_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "damage_estimates_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "damage_estimates_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "damage_estimates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "damage_estimates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      db_load_snapshots: {
        Row: {
          calls: number
          captured_at: string
          id: number
          max_ms: number
          mean_ms: number
          query_text: string
          queryid: number | null
          rows: number
          total_ms: number
        }
        Insert: {
          calls: number
          captured_at?: string
          id?: number
          max_ms: number
          mean_ms: number
          query_text: string
          queryid?: number | null
          rows?: number
          total_ms: number
        }
        Update: {
          calls?: number
          captured_at?: string
          id?: number
          max_ms?: number
          mean_ms?: number
          query_text?: string
          queryid?: number | null
          rows?: number
          total_ms?: number
        }
        Relationships: []
      }
      deals: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          expected_close_date: string | null
          id: string
          lead_id: string | null
          notes: string | null
          organization_id: string
          stage: string
          title: string
          updated_at: string
          value: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          expected_close_date?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          organization_id?: string
          stage?: string
          title: string
          updated_at?: string
          value?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          expected_close_date?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          organization_id?: string
          stage?: string
          title?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "deals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "deals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      depot_bank_details: {
        Row: {
          bank_account: string | null
          bank_branch: string | null
          bank_name: string | null
          created_at: string
          depot_id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          bank_account?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          created_at?: string
          depot_id: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          bank_account?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          created_at?: string
          depot_id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "depot_bank_details_depot_id_fkey"
            columns: ["depot_id"]
            isOneToOne: true
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depot_bank_details_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "depot_bank_details_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      depot_lifecycle_events: {
        Row: {
          actor: string | null
          created_at: string
          depot_id: string
          event: string
          id: string
          organization_id: string
          payload: Json
        }
        Insert: {
          actor?: string | null
          created_at?: string
          depot_id: string
          event: string
          id?: string
          organization_id: string
          payload?: Json
        }
        Update: {
          actor?: string | null
          created_at?: string
          depot_id?: string
          event?: string
          id?: string
          organization_id?: string
          payload?: Json
        }
        Relationships: []
      }
      depots: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          code: string
          config: Json | null
          country: string | null
          created_at: string
          currency: string | null
          email: string | null
          id: string
          is_hq: boolean
          location: string | null
          logo_url: string | null
          name: string
          organization_id: string
          phone: string | null
          postal_code: string | null
          registration_number: string | null
          tax_id: string | null
          timezone: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          code: string
          config?: Json | null
          country?: string | null
          created_at?: string
          currency?: string | null
          email?: string | null
          id?: string
          is_hq?: boolean
          location?: string | null
          logo_url?: string | null
          name: string
          organization_id?: string
          phone?: string | null
          postal_code?: string | null
          registration_number?: string | null
          tax_id?: string | null
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          code?: string
          config?: Json | null
          country?: string | null
          created_at?: string
          currency?: string | null
          email?: string | null
          id?: string
          is_hq?: boolean
          location?: string | null
          logo_url?: string | null
          name?: string
          organization_id?: string
          phone?: string | null
          postal_code?: string | null
          registration_number?: string | null
          tax_id?: string | null
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "depots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "depots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dunning_log: {
        Row: {
          channel: string
          created_by: string | null
          id: string
          invoice_id: string
          message: string | null
          organization_id: string
          rule_id: string | null
          sent_at: string
          status: string
        }
        Insert: {
          channel: string
          created_by?: string | null
          id?: string
          invoice_id: string
          message?: string | null
          organization_id?: string
          rule_id?: string | null
          sent_at?: string
          status?: string
        }
        Update: {
          channel?: string
          created_by?: string | null
          id?: string
          invoice_id?: string
          message?: string | null
          organization_id?: string
          rule_id?: string | null
          sent_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "dunning_log_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dunning_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "dunning_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dunning_log_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "dunning_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      dunning_rules: {
        Row: {
          channel: string
          created_at: string
          days_after_due: number
          id: string
          is_active: boolean
          name: string
          organization_id: string
          template: string | null
        }
        Insert: {
          channel?: string
          created_at?: string
          days_after_due: number
          id?: string
          is_active?: boolean
          name: string
          organization_id?: string
          template?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          days_after_due?: number
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          template?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dunning_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "dunning_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      edi_exports: {
        Row: {
          byte_size: number | null
          created_at: string
          created_by: string | null
          downloaded_at: string | null
          downloaded_by: string | null
          error: string | null
          format: string
          generated_at: string
          id: string
          interchange_control_ref: string | null
          invoice_id: string | null
          message_ref: string | null
          organization_id: string
          payload: string | null
          sha256: string | null
          status: string
          supplier_invoice_id: string | null
          updated_at: string
        }
        Insert: {
          byte_size?: number | null
          created_at?: string
          created_by?: string | null
          downloaded_at?: string | null
          downloaded_by?: string | null
          error?: string | null
          format?: string
          generated_at?: string
          id?: string
          interchange_control_ref?: string | null
          invoice_id?: string | null
          message_ref?: string | null
          organization_id: string
          payload?: string | null
          sha256?: string | null
          status?: string
          supplier_invoice_id?: string | null
          updated_at?: string
        }
        Update: {
          byte_size?: number | null
          created_at?: string
          created_by?: string | null
          downloaded_at?: string | null
          downloaded_by?: string | null
          error?: string | null
          format?: string
          generated_at?: string
          id?: string
          interchange_control_ref?: string | null
          invoice_id?: string | null
          message_ref?: string | null
          organization_id?: string
          payload?: string | null
          sha256?: string | null
          status?: string
          supplier_invoice_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "edi_exports_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edi_exports_supplier_invoice_id_fkey"
            columns: ["supplier_invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      edi_interchange_seq: {
        Row: {
          last_value: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          last_value?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          last_value?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      eir_records: {
        Row: {
          acquisition_supplier: string | null
          appointment_id: string | null
          approval_request_id: string | null
          approval_status: Database["public"]["Enums"]["approval_doc_status"]
          approved_at: string | null
          approved_by: string | null
          cargo_status: string
          completed_at: string | null
          condition_grade: Database["public"]["Enums"]["condition_grade"]
          container_id: string | null
          created_at: string
          created_by: string | null
          damage_description: string | null
          driver_id_number: string | null
          driver_name: string | null
          driver_phone: string | null
          eir_number: string
          eir_type: Database["public"]["Enums"]["eir_type"]
          fx_rate_snapshot: number | null
          gate_fee_amount: number | null
          gate_fee_currency: string | null
          gate_fee_invoice_id: string | null
          id: string
          inspected_by: string | null
          inspector_notes: string | null
          lease_agreement_id: string | null
          lease_invoice_id: string | null
          lease_unit_id: string | null
          new_owner: string | null
          nominated_depot: string | null
          organization_id: string
          origin_location: string | null
          owner_at_issue: string | null
          owner_resolved_at: string | null
          owner_resolved_by: string | null
          owner_source: string | null
          photos: Json | null
          pickup_depot_id: string | null
          purchase_price_currency: string | null
          purchase_price_snapshot: number | null
          reference_rate: number | null
          rejection_reason: string | null
          release_purpose: string | null
          released_by_name: string | null
          released_by_role: string | null
          seal_number: string | null
          supplier_invoice_id: string | null
          transporter_company: string | null
          transporter_indemnity_signed: boolean
          transporter_indemnity_signed_at: string | null
          transporter_indemnity_signer: string | null
          truck_plate: string | null
          updated_at: string
        }
        Insert: {
          acquisition_supplier?: string | null
          appointment_id?: string | null
          approval_request_id?: string | null
          approval_status?: Database["public"]["Enums"]["approval_doc_status"]
          approved_at?: string | null
          approved_by?: string | null
          cargo_status?: string
          completed_at?: string | null
          condition_grade?: Database["public"]["Enums"]["condition_grade"]
          container_id?: string | null
          created_at?: string
          created_by?: string | null
          damage_description?: string | null
          driver_id_number?: string | null
          driver_name?: string | null
          driver_phone?: string | null
          eir_number: string
          eir_type: Database["public"]["Enums"]["eir_type"]
          fx_rate_snapshot?: number | null
          gate_fee_amount?: number | null
          gate_fee_currency?: string | null
          gate_fee_invoice_id?: string | null
          id?: string
          inspected_by?: string | null
          inspector_notes?: string | null
          lease_agreement_id?: string | null
          lease_invoice_id?: string | null
          lease_unit_id?: string | null
          new_owner?: string | null
          nominated_depot?: string | null
          organization_id?: string
          origin_location?: string | null
          owner_at_issue?: string | null
          owner_resolved_at?: string | null
          owner_resolved_by?: string | null
          owner_source?: string | null
          photos?: Json | null
          pickup_depot_id?: string | null
          purchase_price_currency?: string | null
          purchase_price_snapshot?: number | null
          reference_rate?: number | null
          rejection_reason?: string | null
          release_purpose?: string | null
          released_by_name?: string | null
          released_by_role?: string | null
          seal_number?: string | null
          supplier_invoice_id?: string | null
          transporter_company?: string | null
          transporter_indemnity_signed?: boolean
          transporter_indemnity_signed_at?: string | null
          transporter_indemnity_signer?: string | null
          truck_plate?: string | null
          updated_at?: string
        }
        Update: {
          acquisition_supplier?: string | null
          appointment_id?: string | null
          approval_request_id?: string | null
          approval_status?: Database["public"]["Enums"]["approval_doc_status"]
          approved_at?: string | null
          approved_by?: string | null
          cargo_status?: string
          completed_at?: string | null
          condition_grade?: Database["public"]["Enums"]["condition_grade"]
          container_id?: string | null
          created_at?: string
          created_by?: string | null
          damage_description?: string | null
          driver_id_number?: string | null
          driver_name?: string | null
          driver_phone?: string | null
          eir_number?: string
          eir_type?: Database["public"]["Enums"]["eir_type"]
          fx_rate_snapshot?: number | null
          gate_fee_amount?: number | null
          gate_fee_currency?: string | null
          gate_fee_invoice_id?: string | null
          id?: string
          inspected_by?: string | null
          inspector_notes?: string | null
          lease_agreement_id?: string | null
          lease_invoice_id?: string | null
          lease_unit_id?: string | null
          new_owner?: string | null
          nominated_depot?: string | null
          organization_id?: string
          origin_location?: string | null
          owner_at_issue?: string | null
          owner_resolved_at?: string | null
          owner_resolved_by?: string | null
          owner_source?: string | null
          photos?: Json | null
          pickup_depot_id?: string | null
          purchase_price_currency?: string | null
          purchase_price_snapshot?: number | null
          reference_rate?: number | null
          rejection_reason?: string | null
          release_purpose?: string | null
          released_by_name?: string | null
          released_by_role?: string | null
          seal_number?: string | null
          supplier_invoice_id?: string | null
          transporter_company?: string | null
          transporter_indemnity_signed?: boolean
          transporter_indemnity_signed_at?: string | null
          transporter_indemnity_signer?: string | null
          truck_plate?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eir_records_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "gate_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eir_records_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eir_records_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eir_records_gate_fee_invoice_id_fkey"
            columns: ["gate_fee_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eir_records_lease_agreement_id_fkey"
            columns: ["lease_agreement_id"]
            isOneToOne: false
            referencedRelation: "lease_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eir_records_lease_invoice_id_fkey"
            columns: ["lease_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eir_records_lease_unit_id_fkey"
            columns: ["lease_unit_id"]
            isOneToOne: false
            referencedRelation: "lease_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eir_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "eir_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eir_records_pickup_depot_id_fkey"
            columns: ["pickup_depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eir_records_supplier_invoice_id_fkey"
            columns: ["supplier_invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      email_resend_attempts: {
        Row: {
          attempted_at: string
          email: string
          id: string
          kind: string
        }
        Insert: {
          attempted_at?: string
          email: string
          id?: string
          kind?: string
        }
        Update: {
          attempted_at?: string
          email?: string
          id?: string
          kind?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      employees: {
        Row: {
          bank_details: Json | null
          code: string | null
          control_account_id: string | null
          created_at: string
          daily_rate: number
          deductions: Json
          division: string | null
          email: string | null
          hired_on: string | null
          holiday_multiplier: number | null
          hourly_rate: number
          id: string
          is_active: boolean
          monthly_salary: number
          name: string
          organization_id: string
          overtime_multiplier: number
          pay_basis: string
          pay_frequency: string
          phone: string | null
          role: string
          status: string
          tax_id: string | null
          termination_date: string | null
        }
        Insert: {
          bank_details?: Json | null
          code?: string | null
          control_account_id?: string | null
          created_at?: string
          daily_rate?: number
          deductions?: Json
          division?: string | null
          email?: string | null
          hired_on?: string | null
          holiday_multiplier?: number | null
          hourly_rate?: number
          id?: string
          is_active?: boolean
          monthly_salary?: number
          name: string
          organization_id?: string
          overtime_multiplier?: number
          pay_basis?: string
          pay_frequency?: string
          phone?: string | null
          role: string
          status?: string
          tax_id?: string | null
          termination_date?: string | null
        }
        Update: {
          bank_details?: Json | null
          code?: string | null
          control_account_id?: string | null
          created_at?: string
          daily_rate?: number
          deductions?: Json
          division?: string | null
          email?: string | null
          hired_on?: string | null
          holiday_multiplier?: number | null
          hourly_rate?: number
          id?: string
          is_active?: boolean
          monthly_salary?: number
          name?: string
          organization_id?: string
          overtime_multiplier?: number
          pay_basis?: string
          pay_frequency?: string
          phone?: string | null
          role?: string
          status?: string
          tax_id?: string | null
          termination_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_control_account_id_fkey"
            columns: ["control_account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "employees_control_account_id_fkey"
            columns: ["control_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      etims_submissions: {
        Row: {
          created_at: string
          cu_number: string | null
          id: string
          invoice_id: string
          organization_id: string
          qr_payload: string | null
          raw_response: Json | null
          signed_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          cu_number?: string | null
          id?: string
          invoice_id: string
          organization_id?: string
          qr_payload?: string | null
          raw_response?: Json | null
          signed_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          cu_number?: string | null
          id?: string
          invoice_id?: string
          organization_id?: string
          qr_payload?: string | null
          raw_response?: Json | null
          signed_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "etims_submissions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          code: string | null
          created_at: string
          depot_id: string | null
          gl_account_id: string
          id: string
          is_active: boolean
          is_capitalisable: boolean
          name: string
          organization_id: string
          project_id: string | null
          sort_order: number
          tax_code_id: string | null
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          depot_id?: string | null
          gl_account_id: string
          id?: string
          is_active?: boolean
          is_capitalisable?: boolean
          name: string
          organization_id: string
          project_id?: string | null
          sort_order?: number
          tax_code_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          depot_id?: string | null
          gl_account_id?: string
          id?: string
          is_active?: boolean
          is_capitalisable?: boolean
          name?: string
          organization_id?: string
          project_id?: string | null
          sort_order?: number
          tax_code_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_depot_id_fkey"
            columns: ["depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_categories_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_categories_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["gl_account_id"]
          },
          {
            foreignKeyName: "expense_categories_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "expense_categories_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_categories_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_claim_lines: {
        Row: {
          amount: number
          category: string | null
          claim_id: string
          created_at: string
          description: string | null
          gl_account_id: string | null
          id: string
          organization_id: string
          project_id: string | null
          receipt_url: string | null
          tax_code_id: string | null
        }
        Insert: {
          amount?: number
          category?: string | null
          claim_id: string
          created_at?: string
          description?: string | null
          gl_account_id?: string | null
          id?: string
          organization_id?: string
          project_id?: string | null
          receipt_url?: string | null
          tax_code_id?: string | null
        }
        Update: {
          amount?: number
          category?: string | null
          claim_id?: string
          created_at?: string
          description?: string | null
          gl_account_id?: string | null
          id?: string
          organization_id?: string
          project_id?: string | null
          receipt_url?: string | null
          tax_code_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_claim_lines_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "expense_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_claim_lines_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_claim_lines_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["gl_account_id"]
          },
          {
            foreignKeyName: "expense_claim_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "expense_claim_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_claim_lines_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_claims: {
        Row: {
          approved_at: string | null
          claim_date: string
          claim_number: string
          created_at: string
          created_by: string | null
          employee_id: string | null
          id: string
          notes: string | null
          organization_id: string
          reimbursed_at: string | null
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          claim_date?: string
          claim_number: string
          created_at?: string
          created_by?: string | null
          employee_id?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          reimbursed_at?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          claim_date?: string
          claim_number?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          reimbursed_at?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_claims_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "expense_claims_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_payroll_status"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "expense_claims_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_user_id: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity_id: string
          entity_ref: string | null
          entity_type: string
          id: string
          organization_id: string
          route: string | null
          summary: Json
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id: string
          entity_ref?: string | null
          entity_type: string
          id?: string
          organization_id: string
          route?: string | null
          summary?: Json
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string
          entity_ref?: string | null
          entity_type?: string
          id?: string
          organization_id?: string
          route?: string | null
          summary?: Json
        }
        Relationships: []
      }
      financial_account_bank_details: {
        Row: {
          account_id: string
          account_number: string | null
          bank_name: string | null
          branch: string | null
          created_at: string
          organization_id: string
          swift_bic: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          account_number?: string | null
          bank_name?: string | null
          branch?: string | null
          created_at?: string
          organization_id: string
          swift_bic?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          account_number?: string | null
          bank_name?: string | null
          branch?: string | null
          created_at?: string
          organization_id?: string
          swift_bic?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_account_bank_details_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "financial_account_bank_details_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_account_bank_details_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "financial_account_bank_details_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["financial_account_type"]
          created_at: string
          created_by: string | null
          currency: string | null
          gl_account_id: string | null
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          notes: string | null
          opening_balance: number
          opening_balance_date: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          account_type?: Database["public"]["Enums"]["financial_account_type"]
          created_at?: string
          created_by?: string | null
          currency?: string | null
          gl_account_id?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          notes?: string | null
          opening_balance?: number
          opening_balance_date?: string
          organization_id?: string
          updated_at?: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["financial_account_type"]
          created_at?: string
          created_by?: string | null
          currency?: string | null
          gl_account_id?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          notes?: string | null
          opening_balance?: number
          opening_balance_date?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_accounts_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_accounts_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["gl_account_id"]
          },
          {
            foreignKeyName: "financial_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "financial_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      finished_products: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          description: string | null
          dimensions: Json | null
          gate_out_checklist: Json | null
          gate_out_driver_name: string | null
          gate_out_driver_phone: string | null
          gate_out_indemnity_signed: boolean
          gate_out_indemnity_signer: string | null
          gate_out_notes: string | null
          gate_out_transporter: string | null
          gate_out_truck_plate: string | null
          gated_out_at: string | null
          gated_out_by: string | null
          id: string
          lease_id: string | null
          list_price: number
          location: string | null
          name: string | null
          notes: string | null
          organization_id: string
          photos: Json
          product_number: string
          product_type: Database["public"]["Enums"]["conversion_product_type"]
          sales_order_id: string | null
          serial_no: string | null
          source_container_id: string | null
          source_conversion_id: string | null
          status: Database["public"]["Enums"]["finished_product_status"]
          total_cost: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          description?: string | null
          dimensions?: Json | null
          gate_out_checklist?: Json | null
          gate_out_driver_name?: string | null
          gate_out_driver_phone?: string | null
          gate_out_indemnity_signed?: boolean
          gate_out_indemnity_signer?: string | null
          gate_out_notes?: string | null
          gate_out_transporter?: string | null
          gate_out_truck_plate?: string | null
          gated_out_at?: string | null
          gated_out_by?: string | null
          id?: string
          lease_id?: string | null
          list_price?: number
          location?: string | null
          name?: string | null
          notes?: string | null
          organization_id?: string
          photos?: Json
          product_number: string
          product_type?: Database["public"]["Enums"]["conversion_product_type"]
          sales_order_id?: string | null
          serial_no?: string | null
          source_container_id?: string | null
          source_conversion_id?: string | null
          status?: Database["public"]["Enums"]["finished_product_status"]
          total_cost?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          description?: string | null
          dimensions?: Json | null
          gate_out_checklist?: Json | null
          gate_out_driver_name?: string | null
          gate_out_driver_phone?: string | null
          gate_out_indemnity_signed?: boolean
          gate_out_indemnity_signer?: string | null
          gate_out_notes?: string | null
          gate_out_transporter?: string | null
          gate_out_truck_plate?: string | null
          gated_out_at?: string | null
          gated_out_by?: string | null
          id?: string
          lease_id?: string | null
          list_price?: number
          location?: string | null
          name?: string | null
          notes?: string | null
          organization_id?: string
          photos?: Json
          product_number?: string
          product_type?: Database["public"]["Enums"]["conversion_product_type"]
          sales_order_id?: string | null
          serial_no?: string | null
          source_container_id?: string | null
          source_conversion_id?: string | null
          status?: Database["public"]["Enums"]["finished_product_status"]
          total_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finished_products_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_products_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_products_source_container_id_fkey"
            columns: ["source_container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_products_source_conversion_id_fkey"
            columns: ["source_conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_products_source_conversion_id_fkey"
            columns: ["source_conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
        ]
      }
      fiscal_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          end_date: string
          id: string
          month: number
          organization_id: string
          start_date: string
          status: string
          year: number
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          end_date: string
          id?: string
          month: number
          organization_id: string
          start_date: string
          status?: string
          year: number
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          end_date?: string
          id?: string
          month?: number
          organization_id?: string
          start_date?: string
          status?: string
          year?: number
        }
        Relationships: []
      }
      fixed_asset_depreciation_runs: {
        Row: {
          asset_count: number
          id: string
          journal_id: string | null
          notes: string | null
          organization_id: string
          period_id: string
          run_at: string
          total_depreciation: number
        }
        Insert: {
          asset_count?: number
          id?: string
          journal_id?: string | null
          notes?: string | null
          organization_id?: string
          period_id: string
          run_at?: string
          total_depreciation?: number
        }
        Update: {
          asset_count?: number
          id?: string
          journal_id?: string | null
          notes?: string | null
          organization_id?: string
          period_id?: string
          run_at?: string
          total_depreciation?: number
        }
        Relationships: [
          {
            foreignKeyName: "fixed_asset_depreciation_runs_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "fiscal_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_assets: {
        Row: {
          accumulated_depreciation: number
          acquisition_date: string
          asset_class: Database["public"]["Enums"]["asset_class"]
          category: string | null
          code: string
          condition: Database["public"]["Enums"]["asset_condition"]
          cost: number
          created_at: string
          custodian_employee_id: string | null
          depot_id: string | null
          disposal_gain_loss: number | null
          disposal_method:
            | Database["public"]["Enums"]["asset_disposal_method"]
            | null
          disposal_proceeds: number | null
          disposed_at: string | null
          gl_asset_account: string | null
          gl_depr_account: string | null
          gl_expense_account: string | null
          id: string
          is_issuable: boolean
          manufacturer: string | null
          method: string
          model: string | null
          name: string
          next_service_at: string | null
          notes: string | null
          organization_id: string
          salvage_value: number
          serial_number: string | null
          service_interval_days: number | null
          status: string
          tag_number: string | null
          updated_at: string
          useful_life_months: number
          vehicle_id: string | null
          warranty_expiry: string | null
        }
        Insert: {
          accumulated_depreciation?: number
          acquisition_date?: string
          asset_class?: Database["public"]["Enums"]["asset_class"]
          category?: string | null
          code: string
          condition?: Database["public"]["Enums"]["asset_condition"]
          cost?: number
          created_at?: string
          custodian_employee_id?: string | null
          depot_id?: string | null
          disposal_gain_loss?: number | null
          disposal_method?:
            | Database["public"]["Enums"]["asset_disposal_method"]
            | null
          disposal_proceeds?: number | null
          disposed_at?: string | null
          gl_asset_account?: string | null
          gl_depr_account?: string | null
          gl_expense_account?: string | null
          id?: string
          is_issuable?: boolean
          manufacturer?: string | null
          method?: string
          model?: string | null
          name: string
          next_service_at?: string | null
          notes?: string | null
          organization_id?: string
          salvage_value?: number
          serial_number?: string | null
          service_interval_days?: number | null
          status?: string
          tag_number?: string | null
          updated_at?: string
          useful_life_months?: number
          vehicle_id?: string | null
          warranty_expiry?: string | null
        }
        Update: {
          accumulated_depreciation?: number
          acquisition_date?: string
          asset_class?: Database["public"]["Enums"]["asset_class"]
          category?: string | null
          code?: string
          condition?: Database["public"]["Enums"]["asset_condition"]
          cost?: number
          created_at?: string
          custodian_employee_id?: string | null
          depot_id?: string | null
          disposal_gain_loss?: number | null
          disposal_method?:
            | Database["public"]["Enums"]["asset_disposal_method"]
            | null
          disposal_proceeds?: number | null
          disposed_at?: string | null
          gl_asset_account?: string | null
          gl_depr_account?: string | null
          gl_expense_account?: string | null
          id?: string
          is_issuable?: boolean
          manufacturer?: string | null
          method?: string
          model?: string | null
          name?: string
          next_service_at?: string | null
          notes?: string | null
          organization_id?: string
          salvage_value?: number
          serial_number?: string | null
          service_interval_days?: number | null
          status?: string
          tag_number?: string | null
          updated_at?: string
          useful_life_months?: number
          vehicle_id?: string | null
          warranty_expiry?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_custodian_employee_id_fkey"
            columns: ["custodian_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "fixed_assets_custodian_employee_id_fkey"
            columns: ["custodian_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_payroll_status"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "fixed_assets_custodian_employee_id_fkey"
            columns: ["custodian_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_depot_id_fkey"
            columns: ["depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_gl_asset_account_fkey"
            columns: ["gl_asset_account"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_gl_asset_account_fkey"
            columns: ["gl_asset_account"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["gl_account_id"]
          },
          {
            foreignKeyName: "fixed_assets_gl_depr_account_fkey"
            columns: ["gl_depr_account"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_gl_depr_account_fkey"
            columns: ["gl_depr_account"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["gl_account_id"]
          },
          {
            foreignKeyName: "fixed_assets_gl_expense_account_fkey"
            columns: ["gl_expense_account"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_gl_expense_account_fkey"
            columns: ["gl_expense_account"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["gl_account_id"]
          },
          {
            foreignKeyName: "fixed_assets_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "logistics_vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_rates: {
        Row: {
          as_of_date: string
          created_at: string
          currency_from: string
          currency_to: string
          id: string
          organization_id: string
          rate: number
          source: string | null
        }
        Insert: {
          as_of_date?: string
          created_at?: string
          currency_from: string
          currency_to: string
          id?: string
          organization_id?: string
          rate: number
          source?: string | null
        }
        Update: {
          as_of_date?: string
          created_at?: string
          currency_from?: string
          currency_to?: string
          id?: string
          organization_id?: string
          rate?: number
          source?: string | null
        }
        Relationships: []
      }
      fx_revaluation_runs: {
        Row: {
          created_at: string
          gain_loss_total: number
          id: string
          journal_id: string | null
          notes: string | null
          organization_id: string
          period_id: string
          run_at: string
        }
        Insert: {
          created_at?: string
          gain_loss_total?: number
          id?: string
          journal_id?: string | null
          notes?: string | null
          organization_id?: string
          period_id: string
          run_at?: string
        }
        Update: {
          created_at?: string
          gain_loss_total?: number
          id?: string
          journal_id?: string | null
          notes?: string | null
          organization_id?: string
          period_id?: string
          run_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fx_revaluation_runs_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "fiscal_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      gate_appointments: {
        Row: {
          appointment_number: string
          appointment_type: string
          container_id: string | null
          container_number: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          driver_license: string | null
          driver_name: string | null
          id: string
          notes: string | null
          organization_id: string
          scheduled_at: string
          shipping_line: string | null
          status: Database["public"]["Enums"]["appointment_status"]
          truck_plate: string | null
          updated_at: string
        }
        Insert: {
          appointment_number: string
          appointment_type: string
          container_id?: string | null
          container_number?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          driver_license?: string | null
          driver_name?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          scheduled_at: string
          shipping_line?: string | null
          status?: Database["public"]["Enums"]["appointment_status"]
          truck_plate?: string | null
          updated_at?: string
        }
        Update: {
          appointment_number?: string
          appointment_type?: string
          container_id?: string | null
          container_number?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          driver_license?: string | null
          driver_name?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          scheduled_at?: string
          shipping_line?: string | null
          status?: Database["public"]["Enums"]["appointment_status"]
          truck_plate?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gate_appointments_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_appointments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_appointments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "gate_appointments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          code: string
          created_at: string
          currency: string | null
          description: string | null
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          organization_id: string
          parent_id: string | null
          system_code: string | null
          updated_at: string
        }
        Insert: {
          account_type: Database["public"]["Enums"]["account_type"]
          code: string
          created_at?: string
          currency?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          organization_id: string
          parent_id?: string | null
          system_code?: string | null
          updated_at?: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          code?: string
          created_at?: string
          currency?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          organization_id?: string
          parent_id?: string | null
          system_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gl_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["gl_account_id"]
          },
        ]
      }
      goods_receipt_audit: {
        Row: {
          action: string
          actor_email: string | null
          actor_user_id: string | null
          created_at: string
          id: string
          organization_id: string
          payload: Json | null
          po_id: string | null
          receipt_id: string
          receipt_item_id: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          payload?: Json | null
          po_id?: string | null
          receipt_id: string
          receipt_item_id?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          payload?: Json | null
          po_id?: string | null
          receipt_id?: string
          receipt_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_audit_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_audit_receipt_item_id_fkey"
            columns: ["receipt_item_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_items"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipt_items: {
        Row: {
          allocated_conversion_material_id: string | null
          created_at: string
          id: string
          is_vatable: boolean
          ordered_qty: number
          organization_id: string
          po_item_id: string
          receipt_id: string
          received_qty: number
          tax_amount: number
          tax_rate: number
          variance_reason: string | null
          variance_type: string
        }
        Insert: {
          allocated_conversion_material_id?: string | null
          created_at?: string
          id?: string
          is_vatable?: boolean
          ordered_qty?: number
          organization_id?: string
          po_item_id: string
          receipt_id: string
          received_qty?: number
          tax_amount?: number
          tax_rate?: number
          variance_reason?: string | null
          variance_type?: string
        }
        Update: {
          allocated_conversion_material_id?: string | null
          created_at?: string
          id?: string
          is_vatable?: boolean
          ordered_qty?: number
          organization_id?: string
          po_item_id?: string
          receipt_id?: string
          received_qty?: number
          tax_amount?: number
          tax_rate?: number
          variance_reason?: string | null
          variance_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "goods_receipt_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_items_po_item_id_fkey"
            columns: ["po_item_id"]
            isOneToOne: false
            referencedRelation: "po_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_items_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipts: {
        Row: {
          approval_request_id: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          credit_note_invoice_id: string | null
          has_variance: boolean
          id: string
          is_void: boolean
          notes: string | null
          organization_id: string
          po_id: string
          received_at: string
          received_by: string | null
          rejected_reason: string | null
          submitted_at: string | null
          submitted_by: string | null
          supplementary_po_id: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          approval_request_id?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          credit_note_invoice_id?: string | null
          has_variance?: boolean
          id?: string
          is_void?: boolean
          notes?: string | null
          organization_id?: string
          po_id: string
          received_at?: string
          received_by?: string | null
          rejected_reason?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          supplementary_po_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          approval_request_id?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          credit_note_invoice_id?: string | null
          has_variance?: boolean
          id?: string
          is_void?: boolean
          notes?: string | null
          organization_id?: string
          po_id?: string
          received_at?: string
          received_by?: string | null
          rejected_reason?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          supplementary_po_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "goods_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_vat_summary"
            referencedColumns: ["purchase_order_id"]
          },
          {
            foreignKeyName: "goods_receipts_supplementary_po_id_fkey"
            columns: ["supplementary_po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_supplementary_po_id_fkey"
            columns: ["supplementary_po_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_vat_summary"
            referencedColumns: ["purchase_order_id"]
          },
        ]
      }
      hrm_employee_code_seq: {
        Row: {
          next_number: number
          organization_id: string
          prefix: string
        }
        Insert: {
          next_number?: number
          organization_id: string
          prefix: string
        }
        Update: {
          next_number?: number
          organization_id?: string
          prefix?: string
        }
        Relationships: []
      }
      import_audit_rows: {
        Row: {
          business_key: string
          created_at: string
          created_by: string | null
          id: string
          message: string | null
          organization_id: string
          outcome: string
          payload: Json | null
          row_number: number | null
          table_name: string
        }
        Insert: {
          business_key: string
          created_at?: string
          created_by?: string | null
          id?: string
          message?: string | null
          organization_id?: string
          outcome: string
          payload?: Json | null
          row_number?: number | null
          table_name: string
        }
        Update: {
          business_key?: string
          created_at?: string
          created_by?: string | null
          id?: string
          message?: string | null
          organization_id?: string
          outcome?: string
          payload?: Json | null
          row_number?: number | null
          table_name?: string
        }
        Relationships: []
      }
      inspections: {
        Row: {
          condition_grade: Database["public"]["Enums"]["condition_grade"]
          container_id: string | null
          created_at: string
          findings: string | null
          id: string
          inspected_by: string | null
          inspection_number: string
          inspection_type: Database["public"]["Enums"]["inspection_type"]
          inspector_notes: string | null
          organization_id: string
          photos: Json | null
          requires_repair: boolean
          updated_at: string
        }
        Insert: {
          condition_grade?: Database["public"]["Enums"]["condition_grade"]
          container_id?: string | null
          created_at?: string
          findings?: string | null
          id?: string
          inspected_by?: string | null
          inspection_number: string
          inspection_type?: Database["public"]["Enums"]["inspection_type"]
          inspector_notes?: string | null
          organization_id?: string
          photos?: Json | null
          requires_repair?: boolean
          updated_at?: string
        }
        Update: {
          condition_grade?: Database["public"]["Enums"]["condition_grade"]
          container_id?: string | null
          created_at?: string
          findings?: string | null
          id?: string
          inspected_by?: string | null
          inspection_number?: string
          inspection_type?: Database["public"]["Enums"]["inspection_type"]
          inspector_notes?: string | null
          organization_id?: string
          photos?: Json | null
          requires_repair?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspections_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "inspections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inter_account_transfers: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          description: string | null
          fees: number
          from_account_id: string
          fx_rate: number
          id: string
          organization_id: string
          reference: string | null
          to_account_id: string
          transfer_date: string
          transfer_number: string
          updated_at: string
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          fees?: number
          from_account_id: string
          fx_rate?: number
          id?: string
          organization_id?: string
          reference?: string | null
          to_account_id: string
          transfer_date?: string
          transfer_number: string
          updated_at?: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          fees?: number
          from_account_id?: string
          fx_rate?: number
          id?: string
          organization_id?: string
          reference?: string | null
          to_account_id?: string
          transfer_date?: string
          transfer_number?: string
          updated_at?: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inter_account_transfers_from_account_id_fkey"
            columns: ["from_account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "inter_account_transfers_from_account_id_fkey"
            columns: ["from_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inter_account_transfers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "inter_account_transfers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inter_account_transfers_to_account_id_fkey"
            columns: ["to_account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "inter_account_transfers_to_account_id_fkey"
            columns: ["to_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_containers: {
        Row: {
          container_id: string
          created_at: string
          id: string
          invoice_id: string
          organization_id: string
        }
        Insert: {
          container_id: string
          created_at?: string
          id?: string
          invoice_id: string
          organization_id?: string
        }
        Update: {
          container_id?: string
          created_at?: string
          id?: string
          invoice_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_containers_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_containers_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_currency_audit: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_currency: string | null
          id: string
          invoice_id: string
          invoice_kind: string
          organization_id: string
          reason: string
          to_currency: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_currency?: string | null
          id?: string
          invoice_id: string
          invoice_kind: string
          organization_id: string
          reason: string
          to_currency: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_currency?: string | null
          id?: string
          invoice_id?: string
          invoice_kind?: string
          organization_id?: string
          reason?: string
          to_currency?: string
        }
        Relationships: []
      }
      invoice_line_items: {
        Row: {
          charge_type: Database["public"]["Enums"]["charge_type"]
          created_at: string
          description: string
          id: string
          invoice_id: string
          organization_id: string
          period_from: string | null
          period_to: string | null
          quantity: number
          tax_code_id: string | null
          total_price: number
          unit_price: number
        }
        Insert: {
          charge_type?: Database["public"]["Enums"]["charge_type"]
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          organization_id?: string
          period_from?: string | null
          period_to?: string | null
          quantity?: number
          tax_code_id?: string | null
          total_price?: number
          unit_price?: number
        }
        Update: {
          charge_type?: Database["public"]["Enums"]["charge_type"]
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          organization_id?: string
          period_from?: string | null
          period_to?: string | null
          quantity?: number
          tax_code_id?: string | null
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "invoice_line_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          container_id: string | null
          created_at: string
          created_by: string | null
          credit_of_invoice_id: string | null
          currency: string | null
          customer_id: string | null
          customer_name: string
          customer_reference: string | null
          due_at: string | null
          id: string
          invoice_number: string
          invoice_type: Database["public"]["Enums"]["charge_type"]
          issued_at: string | null
          notes: string | null
          organization_id: string
          paid_at: string | null
          partially_paid: boolean
          project_id: string | null
          source_eir_id: string | null
          source_movement_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tax_amount: number
          tax_rate: number
          total_amount: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          container_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_of_invoice_id?: string | null
          currency?: string | null
          customer_id?: string | null
          customer_name: string
          customer_reference?: string | null
          due_at?: string | null
          id?: string
          invoice_number: string
          invoice_type?: Database["public"]["Enums"]["charge_type"]
          issued_at?: string | null
          notes?: string | null
          organization_id?: string
          paid_at?: string | null
          partially_paid?: boolean
          project_id?: string | null
          source_eir_id?: string | null
          source_movement_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          total_amount?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          container_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_of_invoice_id?: string | null
          currency?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_reference?: string | null
          due_at?: string | null
          id?: string
          invoice_number?: string
          invoice_type?: Database["public"]["Enums"]["charge_type"]
          issued_at?: string | null
          notes?: string | null
          organization_id?: string
          paid_at?: string | null
          partially_paid?: boolean
          project_id?: string | null
          source_eir_id?: string | null
          source_movement_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          total_amount?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_credit_of_invoice_id_fkey"
            columns: ["credit_of_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_source_eir_id_fkey"
            columns: ["source_eir_id"]
            isOneToOne: false
            referencedRelation: "eir_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_source_movement_id_fkey"
            columns: ["source_movement_id"]
            isOneToOne: false
            referencedRelation: "container_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          contact_email: string | null
          contact_name: string
          contact_phone: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          metadata: Json
          notes: string | null
          organization_id: string
          source: string
          status: string
        }
        Insert: {
          contact_email?: string | null
          contact_name: string
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          organization_id?: string
          source?: string
          status?: string
        }
        Update: {
          contact_email?: string | null
          contact_name?: string
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          organization_id?: string
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lease_agreements: {
        Row: {
          agreement_pdf_url: string | null
          auto_renew: boolean
          billing_cycle: Database["public"]["Enums"]["lease_billing_cycle"]
          container_category:
            | Database["public"]["Enums"]["container_category"]
            | null
          container_size: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          customer_id: string | null
          default_per_diem: number
          dpp_cap_per_unit: number
          dpp_enabled: boolean
          dpp_rate_per_day: number
          dropoff_fee: number
          end_date: string | null
          free_days_pickup: number
          free_days_redelivery: number
          height_class:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id: string
          late_fee_pct: number
          lease_number: string
          lease_type: Database["public"]["Enums"]["lease_type"]
          lessee_name: string
          min_lease_days: number
          min_units_committed: number
          notes: string | null
          organization_id: string
          payment_terms_days: number
          pickup_depots: Json
          pickup_fee: number
          redelivery_depots: Json
          signed_at: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["lease_status"]
          terms_text: string | null
          updated_at: string
        }
        Insert: {
          agreement_pdf_url?: string | null
          auto_renew?: boolean
          billing_cycle?: Database["public"]["Enums"]["lease_billing_cycle"]
          container_category?:
            | Database["public"]["Enums"]["container_category"]
            | null
          container_size?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customer_id?: string | null
          default_per_diem?: number
          dpp_cap_per_unit?: number
          dpp_enabled?: boolean
          dpp_rate_per_day?: number
          dropoff_fee?: number
          end_date?: string | null
          free_days_pickup?: number
          free_days_redelivery?: number
          height_class?:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id?: string
          late_fee_pct?: number
          lease_number: string
          lease_type?: Database["public"]["Enums"]["lease_type"]
          lessee_name: string
          min_lease_days?: number
          min_units_committed?: number
          notes?: string | null
          organization_id?: string
          payment_terms_days?: number
          pickup_depots?: Json
          pickup_fee?: number
          redelivery_depots?: Json
          signed_at?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["lease_status"]
          terms_text?: string | null
          updated_at?: string
        }
        Update: {
          agreement_pdf_url?: string | null
          auto_renew?: boolean
          billing_cycle?: Database["public"]["Enums"]["lease_billing_cycle"]
          container_category?:
            | Database["public"]["Enums"]["container_category"]
            | null
          container_size?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customer_id?: string | null
          default_per_diem?: number
          dpp_cap_per_unit?: number
          dpp_enabled?: boolean
          dpp_rate_per_day?: number
          dropoff_fee?: number
          end_date?: string | null
          free_days_pickup?: number
          free_days_redelivery?: number
          height_class?:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id?: string
          late_fee_pct?: number
          lease_number?: string
          lease_type?: Database["public"]["Enums"]["lease_type"]
          lessee_name?: string
          min_lease_days?: number
          min_units_committed?: number
          notes?: string | null
          organization_id?: string
          payment_terms_days?: number
          pickup_depots?: Json
          pickup_fee?: number
          redelivery_depots?: Json
          signed_at?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["lease_status"]
          terms_text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lease_agreements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "lease_agreements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lease_invoices_run: {
        Row: {
          generated_at: string
          generated_by: string | null
          id: string
          invoice_id: string | null
          lease_id: string
          organization_id: string
          period_end: string
          period_start: string
          total_amount: number
          units_count: number
        }
        Insert: {
          generated_at?: string
          generated_by?: string | null
          id?: string
          invoice_id?: string | null
          lease_id: string
          organization_id?: string
          period_end: string
          period_start: string
          total_amount?: number
          units_count?: number
        }
        Update: {
          generated_at?: string
          generated_by?: string | null
          id?: string
          invoice_id?: string | null
          lease_id?: string
          organization_id?: string
          period_end?: string
          period_start?: string
          total_amount?: number
          units_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "lease_invoices_run_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lease_invoices_run_lease_id_fkey"
            columns: ["lease_id"]
            isOneToOne: false
            referencedRelation: "lease_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lease_invoices_run_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "lease_invoices_run_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lease_quotations: {
        Row: {
          container_category: string | null
          container_size: string | null
          converted_lease_id: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          customer_id: string | null
          dpp_offered: boolean
          dpp_rate_per_day: number
          dropoff_fee: number
          free_days_pickup: number
          free_days_redelivery: number
          height_class:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id: string
          lease_type: Database["public"]["Enums"]["lease_type"]
          lessee_name: string
          notes: string | null
          organization_id: string
          pdf_url: string | null
          pickup_fee: number
          proposed_end_date: string | null
          proposed_per_diem: number
          proposed_start_date: string | null
          quote_number: string
          status: Database["public"]["Enums"]["lease_quote_status"]
          units_offered: number
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          container_category?: string | null
          container_size?: string | null
          converted_lease_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customer_id?: string | null
          dpp_offered?: boolean
          dpp_rate_per_day?: number
          dropoff_fee?: number
          free_days_pickup?: number
          free_days_redelivery?: number
          height_class?:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id?: string
          lease_type?: Database["public"]["Enums"]["lease_type"]
          lessee_name: string
          notes?: string | null
          organization_id?: string
          pdf_url?: string | null
          pickup_fee?: number
          proposed_end_date?: string | null
          proposed_per_diem?: number
          proposed_start_date?: string | null
          quote_number: string
          status?: Database["public"]["Enums"]["lease_quote_status"]
          units_offered?: number
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          container_category?: string | null
          container_size?: string | null
          converted_lease_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customer_id?: string | null
          dpp_offered?: boolean
          dpp_rate_per_day?: number
          dropoff_fee?: number
          free_days_pickup?: number
          free_days_redelivery?: number
          height_class?:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id?: string
          lease_type?: Database["public"]["Enums"]["lease_type"]
          lessee_name?: string
          notes?: string | null
          organization_id?: string
          pdf_url?: string | null
          pickup_fee?: number
          proposed_end_date?: string | null
          proposed_per_diem?: number
          proposed_start_date?: string | null
          quote_number?: string
          status?: Database["public"]["Enums"]["lease_quote_status"]
          units_offered?: number
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lease_quotations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "lease_quotations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lease_rate_cards: {
        Row: {
          container_category: string
          container_size: string
          created_at: string
          height_class:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id: string
          lease_id: string
          organization_id: string
          per_diem_rate: number
          tier_max_days: number | null
          tier_min_days: number
        }
        Insert: {
          container_category: string
          container_size: string
          created_at?: string
          height_class?:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id?: string
          lease_id: string
          organization_id?: string
          per_diem_rate?: number
          tier_max_days?: number | null
          tier_min_days?: number
        }
        Update: {
          container_category?: string
          container_size?: string
          created_at?: string
          height_class?:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id?: string
          lease_id?: string
          organization_id?: string
          per_diem_rate?: number
          tier_max_days?: number | null
          tier_min_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "lease_rate_cards_lease_id_fkey"
            columns: ["lease_id"]
            isOneToOne: false
            referencedRelation: "lease_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lease_rate_cards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "lease_rate_cards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lease_units: {
        Row: {
          container_id: string | null
          created_at: string
          created_by: string | null
          dpp_active: boolean
          effective_per_diem: number
          finished_product_id: string | null
          free_days_used: number
          id: string
          last_invoiced_through: string | null
          lease_id: string
          notes: string | null
          off_hire_at: string | null
          off_hire_eir_id: string | null
          on_hire_at: string | null
          on_hire_eir_id: string | null
          organization_id: string
          picked_up_depot_id: string | null
          redelivered_depot_id: string | null
          redelivery_estimate_id: string | null
          status: Database["public"]["Enums"]["lease_unit_status"]
          updated_at: string
        }
        Insert: {
          container_id?: string | null
          created_at?: string
          created_by?: string | null
          dpp_active?: boolean
          effective_per_diem?: number
          finished_product_id?: string | null
          free_days_used?: number
          id?: string
          last_invoiced_through?: string | null
          lease_id: string
          notes?: string | null
          off_hire_at?: string | null
          off_hire_eir_id?: string | null
          on_hire_at?: string | null
          on_hire_eir_id?: string | null
          organization_id?: string
          picked_up_depot_id?: string | null
          redelivered_depot_id?: string | null
          redelivery_estimate_id?: string | null
          status?: Database["public"]["Enums"]["lease_unit_status"]
          updated_at?: string
        }
        Update: {
          container_id?: string | null
          created_at?: string
          created_by?: string | null
          dpp_active?: boolean
          effective_per_diem?: number
          finished_product_id?: string | null
          free_days_used?: number
          id?: string
          last_invoiced_through?: string | null
          lease_id?: string
          notes?: string | null
          off_hire_at?: string | null
          off_hire_eir_id?: string | null
          on_hire_at?: string | null
          on_hire_eir_id?: string | null
          organization_id?: string
          picked_up_depot_id?: string | null
          redelivered_depot_id?: string | null
          redelivery_estimate_id?: string | null
          status?: Database["public"]["Enums"]["lease_unit_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lease_units_finished_product_id_fkey"
            columns: ["finished_product_id"]
            isOneToOne: false
            referencedRelation: "finished_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lease_units_lease_id_fkey"
            columns: ["lease_id"]
            isOneToOne: false
            referencedRelation: "lease_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lease_units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "lease_units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_facilities: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string | null
          date_granted: string
          financial_account_id: string | null
          fixed_asset_id: string | null
          frequency: string
          id: string
          interest_rate: number
          ledger_cutover_date: string | null
          lender_name: string
          loan_type: Database["public"]["Enums"]["loan_type"]
          maturity_date: string | null
          notes: string | null
          organization_id: string
          payment_day: number | null
          principal_amount: number
          reference: string | null
          repayment_amount: number
          status: Database["public"]["Enums"]["loan_status"]
          stmt_accrued_interest: number | null
          stmt_arrears: number | null
          stmt_as_of: string | null
          stmt_principal_outstanding: number | null
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string | null
          date_granted?: string
          financial_account_id?: string | null
          fixed_asset_id?: string | null
          frequency?: string
          id?: string
          interest_rate?: number
          ledger_cutover_date?: string | null
          lender_name: string
          loan_type?: Database["public"]["Enums"]["loan_type"]
          maturity_date?: string | null
          notes?: string | null
          organization_id?: string
          payment_day?: number | null
          principal_amount?: number
          reference?: string | null
          repayment_amount?: number
          status?: Database["public"]["Enums"]["loan_status"]
          stmt_accrued_interest?: number | null
          stmt_arrears?: number | null
          stmt_as_of?: string | null
          stmt_principal_outstanding?: number | null
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string | null
          date_granted?: string
          financial_account_id?: string | null
          fixed_asset_id?: string | null
          frequency?: string
          id?: string
          interest_rate?: number
          ledger_cutover_date?: string | null
          lender_name?: string
          loan_type?: Database["public"]["Enums"]["loan_type"]
          maturity_date?: string | null
          notes?: string | null
          organization_id?: string
          payment_day?: number | null
          principal_amount?: number
          reference?: string | null
          repayment_amount?: number
          status?: Database["public"]["Enums"]["loan_status"]
          stmt_accrued_interest?: number | null
          stmt_arrears?: number | null
          stmt_as_of?: string | null
          stmt_principal_outstanding?: number | null
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_facilities_financial_account_id_fkey"
            columns: ["financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "loan_facilities_financial_account_id_fkey"
            columns: ["financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_facilities_fixed_asset_id_fkey"
            columns: ["fixed_asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_facilities_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_schedule_lines: {
        Row: {
          closing_balance: number
          created_at: string
          due_date: string
          id: string
          interest_due: number
          loan_id: string
          opening_balance: number
          organization_id: string
          paid_amount: number
          principal_due: number
          seq: number
          status: Database["public"]["Enums"]["loan_schedule_status"]
          total_due: number
          updated_at: string
        }
        Insert: {
          closing_balance?: number
          created_at?: string
          due_date: string
          id?: string
          interest_due?: number
          loan_id: string
          opening_balance?: number
          organization_id?: string
          paid_amount?: number
          principal_due?: number
          seq: number
          status?: Database["public"]["Enums"]["loan_schedule_status"]
          total_due?: number
          updated_at?: string
        }
        Update: {
          closing_balance?: number
          created_at?: string
          due_date?: string
          id?: string
          interest_due?: number
          loan_id?: string
          opening_balance?: number
          organization_id?: string
          paid_amount?: number
          principal_due?: number
          seq?: number
          status?: Database["public"]["Enums"]["loan_schedule_status"]
          total_due?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_schedule_lines_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loan_facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_transactions: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          currency: string | null
          description: string | null
          external_ref: string | null
          financial_account_id: string | null
          id: string
          loan_id: string
          organization_id: string
          posted: boolean
          posts_to_ledger: boolean
          source: string
          statement_balance: number | null
          txn_date: string
          txn_type: Database["public"]["Enums"]["loan_txn_type"]
          updated_at: string
          value_date: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          currency?: string | null
          description?: string | null
          external_ref?: string | null
          financial_account_id?: string | null
          id?: string
          loan_id: string
          organization_id?: string
          posted?: boolean
          posts_to_ledger?: boolean
          source?: string
          statement_balance?: number | null
          txn_date?: string
          txn_type: Database["public"]["Enums"]["loan_txn_type"]
          updated_at?: string
          value_date?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          currency?: string | null
          description?: string | null
          external_ref?: string | null
          financial_account_id?: string | null
          id?: string
          loan_id?: string
          organization_id?: string
          posted?: boolean
          posts_to_ledger?: boolean
          source?: string
          statement_balance?: number | null
          txn_date?: string
          txn_type?: Database["public"]["Enums"]["loan_txn_type"]
          updated_at?: string
          value_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loan_transactions_financial_account_id_fkey"
            columns: ["financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "loan_transactions_financial_account_id_fkey"
            columns: ["financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_transactions_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loan_facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_carrier_rates: {
        Row: {
          amount: number
          carrier_id: string
          container_size: string | null
          created_at: string
          currency: string | null
          effective_from: string
          effective_to: string | null
          id: string
          notes: string | null
          organization_id: string
          rate_type: Database["public"]["Enums"]["logistics_rate_type"]
          route_id: string | null
        }
        Insert: {
          amount: number
          carrier_id: string
          container_size?: string | null
          created_at?: string
          currency?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          rate_type?: Database["public"]["Enums"]["logistics_rate_type"]
          route_id?: string | null
        }
        Update: {
          amount?: number
          carrier_id?: string
          container_size?: string | null
          created_at?: string
          currency?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          rate_type?: Database["public"]["Enums"]["logistics_rate_type"]
          route_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logistics_carrier_rates_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "logistics_carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_carrier_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "logistics_carrier_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_carrier_rates_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "logistics_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_carriers: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          default_currency: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          organization_id: string
          supplier_id: string | null
          type: Database["public"]["Enums"]["logistics_carrier_type"]
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          default_currency?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          organization_id?: string
          supplier_id?: string | null
          type?: Database["public"]["Enums"]["logistics_carrier_type"]
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          default_currency?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          organization_id?: string
          supplier_id?: string | null
          type?: Database["public"]["Enums"]["logistics_carrier_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "logistics_carriers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "logistics_carriers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_carriers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_drivers: {
        Row: {
          carrier_id: string | null
          created_at: string
          id: string
          is_active: boolean
          license_expiry: string | null
          license_no: string | null
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          carrier_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          license_expiry?: string | null
          license_no?: string | null
          name: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          carrier_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          license_expiry?: string | null
          license_no?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "logistics_drivers_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "logistics_carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_drivers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "logistics_drivers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_routes: {
        Row: {
          code: string
          created_at: string
          currency: string | null
          default_carrier_id: string | null
          default_duration_min: number | null
          default_rate: number | null
          destination: string
          distance_km: number | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          origin: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          currency?: string | null
          default_carrier_id?: string | null
          default_duration_min?: number | null
          default_rate?: number | null
          destination: string
          distance_km?: number | null
          id?: string
          is_active?: boolean
          name: string
          organization_id?: string
          origin: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          currency?: string | null
          default_carrier_id?: string | null
          default_duration_min?: number | null
          default_rate?: number | null
          destination?: string
          distance_km?: number | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          origin?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "logistics_routes_default_carrier_id_fkey"
            columns: ["default_carrier_id"]
            isOneToOne: false
            referencedRelation: "logistics_carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_routes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "logistics_routes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_shuttle_schedules: {
        Row: {
          auto_create_trips: boolean
          created_at: string
          days_of_week: number[]
          default_carrier_id: string | null
          default_driver_id: string | null
          default_vehicle_id: string | null
          departure_times: string[]
          id: string
          is_active: boolean
          lead_days: number
          name: string
          organization_id: string
          route_id: string
          updated_at: string
        }
        Insert: {
          auto_create_trips?: boolean
          created_at?: string
          days_of_week?: number[]
          default_carrier_id?: string | null
          default_driver_id?: string | null
          default_vehicle_id?: string | null
          departure_times?: string[]
          id?: string
          is_active?: boolean
          lead_days?: number
          name: string
          organization_id?: string
          route_id: string
          updated_at?: string
        }
        Update: {
          auto_create_trips?: boolean
          created_at?: string
          days_of_week?: number[]
          default_carrier_id?: string | null
          default_driver_id?: string | null
          default_vehicle_id?: string | null
          departure_times?: string[]
          id?: string
          is_active?: boolean
          lead_days?: number
          name?: string
          organization_id?: string
          route_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "logistics_shuttle_schedules_default_carrier_id_fkey"
            columns: ["default_carrier_id"]
            isOneToOne: false
            referencedRelation: "logistics_carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_shuttle_schedules_default_driver_id_fkey"
            columns: ["default_driver_id"]
            isOneToOne: false
            referencedRelation: "logistics_drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_shuttle_schedules_default_vehicle_id_fkey"
            columns: ["default_vehicle_id"]
            isOneToOne: false
            referencedRelation: "logistics_vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_shuttle_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "logistics_shuttle_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_shuttle_schedules_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "logistics_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_transport_orders: {
        Row: {
          balance_invoice_id: string | null
          billing_mode: Database["public"]["Enums"]["logistics_billing_mode"]
          cargo_description: string | null
          container_ids: string[] | null
          container_owner_charge: number
          container_owner_currency: string | null
          container_owner_customer_id: string | null
          container_owner_fx_rate: number | null
          container_owner_invoice_id: string | null
          container_owner_notes: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          customer_id: string | null
          customer_name: string | null
          deposit_approved_at: string | null
          deposit_dispute_reason: string | null
          deposit_disputed_at: string | null
          deposit_invoice_id: string | null
          deposit_pct: number
          deposit_proposed_at: string | null
          deposit_status: string
          dropoff_location: string
          fx_rate: number | null
          id: string
          invoice_id: string | null
          order_type: Database["public"]["Enums"]["logistics_order_type"]
          organization_id: string
          pickup_location: string
          qty: number | null
          quoted_price: number
          ref: string
          route_id: string | null
          service_date: string
          special_instructions: string | null
          status: Database["public"]["Enums"]["logistics_order_status"]
          updated_at: string
        }
        Insert: {
          balance_invoice_id?: string | null
          billing_mode?: Database["public"]["Enums"]["logistics_billing_mode"]
          cargo_description?: string | null
          container_ids?: string[] | null
          container_owner_charge?: number
          container_owner_currency?: string | null
          container_owner_customer_id?: string | null
          container_owner_fx_rate?: number | null
          container_owner_invoice_id?: string | null
          container_owner_notes?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customer_id?: string | null
          customer_name?: string | null
          deposit_approved_at?: string | null
          deposit_dispute_reason?: string | null
          deposit_disputed_at?: string | null
          deposit_invoice_id?: string | null
          deposit_pct?: number
          deposit_proposed_at?: string | null
          deposit_status?: string
          dropoff_location: string
          fx_rate?: number | null
          id?: string
          invoice_id?: string | null
          order_type?: Database["public"]["Enums"]["logistics_order_type"]
          organization_id?: string
          pickup_location: string
          qty?: number | null
          quoted_price?: number
          ref: string
          route_id?: string | null
          service_date: string
          special_instructions?: string | null
          status?: Database["public"]["Enums"]["logistics_order_status"]
          updated_at?: string
        }
        Update: {
          balance_invoice_id?: string | null
          billing_mode?: Database["public"]["Enums"]["logistics_billing_mode"]
          cargo_description?: string | null
          container_ids?: string[] | null
          container_owner_charge?: number
          container_owner_currency?: string | null
          container_owner_customer_id?: string | null
          container_owner_fx_rate?: number | null
          container_owner_invoice_id?: string | null
          container_owner_notes?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customer_id?: string | null
          customer_name?: string | null
          deposit_approved_at?: string | null
          deposit_dispute_reason?: string | null
          deposit_disputed_at?: string | null
          deposit_invoice_id?: string | null
          deposit_pct?: number
          deposit_proposed_at?: string | null
          deposit_status?: string
          dropoff_location?: string
          fx_rate?: number | null
          id?: string
          invoice_id?: string | null
          order_type?: Database["public"]["Enums"]["logistics_order_type"]
          organization_id?: string
          pickup_location?: string
          qty?: number | null
          quoted_price?: number
          ref?: string
          route_id?: string | null
          service_date?: string
          special_instructions?: string | null
          status?: Database["public"]["Enums"]["logistics_order_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "logistics_transport_orders_balance_invoice_id_fkey"
            columns: ["balance_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_transport_orders_container_owner_customer_id_fkey"
            columns: ["container_owner_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_transport_orders_container_owner_invoice_id_fkey"
            columns: ["container_owner_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_transport_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_transport_orders_deposit_invoice_id_fkey"
            columns: ["deposit_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_transport_orders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_transport_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "logistics_transport_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_transport_orders_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "logistics_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_trip_costs: {
        Row: {
          amount: number
          category: Database["public"]["Enums"]["logistics_cost_category"]
          created_at: string
          currency: string | null
          description: string | null
          expense_txn_id: string | null
          id: string
          odometer_km: number | null
          organization_id: string
          quantity_litres: number | null
          receipt_url: string | null
          recorded_by: string | null
          supplier_id: string | null
          trip_id: string
          unit_price: number | null
        }
        Insert: {
          amount: number
          category: Database["public"]["Enums"]["logistics_cost_category"]
          created_at?: string
          currency?: string | null
          description?: string | null
          expense_txn_id?: string | null
          id?: string
          odometer_km?: number | null
          organization_id?: string
          quantity_litres?: number | null
          receipt_url?: string | null
          recorded_by?: string | null
          supplier_id?: string | null
          trip_id: string
          unit_price?: number | null
        }
        Update: {
          amount?: number
          category?: Database["public"]["Enums"]["logistics_cost_category"]
          created_at?: string
          currency?: string | null
          description?: string | null
          expense_txn_id?: string | null
          id?: string
          odometer_km?: number | null
          organization_id?: string
          quantity_litres?: number | null
          receipt_url?: string | null
          recorded_by?: string | null
          supplier_id?: string | null
          trip_id?: string
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "logistics_trip_costs_expense_txn_id_fkey"
            columns: ["expense_txn_id"]
            isOneToOne: false
            referencedRelation: "accounting_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_trip_costs_expense_txn_id_fkey"
            columns: ["expense_txn_id"]
            isOneToOne: false
            referencedRelation: "currency_integrity_exceptions"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "logistics_trip_costs_expense_txn_id_fkey"
            columns: ["expense_txn_id"]
            isOneToOne: false
            referencedRelation: "v_expense_journal_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_trip_costs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "logistics_trip_costs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_trip_costs_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_trip_costs_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "logistics_trip_pnl"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "logistics_trip_costs_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "logistics_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_trip_legs: {
        Row: {
          container_id: string | null
          created_at: string
          dropoff_at: string | null
          dropoff_location: string | null
          id: string
          organization_id: string
          pickup_at: string | null
          pickup_location: string | null
          pod_signed_at: string | null
          pod_signed_by: string | null
          sequence: number
          signed_pod_url: string | null
          transport_order_id: string | null
          trip_id: string
        }
        Insert: {
          container_id?: string | null
          created_at?: string
          dropoff_at?: string | null
          dropoff_location?: string | null
          id?: string
          organization_id?: string
          pickup_at?: string | null
          pickup_location?: string | null
          pod_signed_at?: string | null
          pod_signed_by?: string | null
          sequence?: number
          signed_pod_url?: string | null
          transport_order_id?: string | null
          trip_id: string
        }
        Update: {
          container_id?: string | null
          created_at?: string
          dropoff_at?: string | null
          dropoff_location?: string | null
          id?: string
          organization_id?: string
          pickup_at?: string | null
          pickup_location?: string | null
          pod_signed_at?: string | null
          pod_signed_by?: string | null
          sequence?: number
          signed_pod_url?: string | null
          transport_order_id?: string | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "logistics_trip_legs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "logistics_trip_legs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_trip_legs_transport_order_id_fkey"
            columns: ["transport_order_id"]
            isOneToOne: false
            referencedRelation: "logistics_transport_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_trip_legs_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "logistics_trip_pnl"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "logistics_trip_legs_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "logistics_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_trip_revenue: {
        Row: {
          amount: number
          created_at: string
          currency: string | null
          id: string
          invoice_id: string | null
          organization_id: string
          transport_order_id: string | null
          trip_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string | null
          id?: string
          invoice_id?: string | null
          organization_id?: string
          transport_order_id?: string | null
          trip_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string | null
          id?: string
          invoice_id?: string | null
          organization_id?: string
          transport_order_id?: string | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "logistics_trip_revenue_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_trip_revenue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "logistics_trip_revenue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_trip_revenue_transport_order_id_fkey"
            columns: ["transport_order_id"]
            isOneToOne: false
            referencedRelation: "logistics_transport_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_trip_revenue_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "logistics_trip_pnl"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "logistics_trip_revenue_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "logistics_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_trips: {
        Row: {
          actual_distance_km: number | null
          arrival_at: string | null
          carrier_id: string | null
          cost_allocation_basis: string
          created_at: string
          created_by: string | null
          departure_at: string | null
          driver_id: string | null
          id: string
          notes: string | null
          odometer_end: number | null
          odometer_start: number | null
          organization_id: string
          planned_distance_km: number | null
          ref: string
          route_id: string | null
          shuttle_schedule_id: string | null
          status: Database["public"]["Enums"]["logistics_trip_status"]
          trip_date: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          actual_distance_km?: number | null
          arrival_at?: string | null
          carrier_id?: string | null
          cost_allocation_basis?: string
          created_at?: string
          created_by?: string | null
          departure_at?: string | null
          driver_id?: string | null
          id?: string
          notes?: string | null
          odometer_end?: number | null
          odometer_start?: number | null
          organization_id?: string
          planned_distance_km?: number | null
          ref: string
          route_id?: string | null
          shuttle_schedule_id?: string | null
          status?: Database["public"]["Enums"]["logistics_trip_status"]
          trip_date: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          actual_distance_km?: number | null
          arrival_at?: string | null
          carrier_id?: string | null
          cost_allocation_basis?: string
          created_at?: string
          created_by?: string | null
          departure_at?: string | null
          driver_id?: string | null
          id?: string
          notes?: string | null
          odometer_end?: number | null
          odometer_start?: number | null
          organization_id?: string
          planned_distance_km?: number | null
          ref?: string
          route_id?: string | null
          shuttle_schedule_id?: string | null
          status?: Database["public"]["Enums"]["logistics_trip_status"]
          trip_date?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logistics_trips_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "logistics_carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "logistics_drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_trips_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "logistics_trips_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_trips_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "logistics_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_trips_shuttle_schedule_id_fkey"
            columns: ["shuttle_schedule_id"]
            isOneToOne: false
            referencedRelation: "logistics_shuttle_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_trips_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "logistics_vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_vehicles: {
        Row: {
          capacity_tons: number | null
          carrier_id: string | null
          container_slots: number | null
          created_at: string
          id: string
          insurance_expiry: string | null
          is_active: boolean
          make: string | null
          model: string | null
          notes: string | null
          odometer: number | null
          organization_id: string
          ownership: string | null
          registration: string
          status: Database["public"]["Enums"]["logistics_vehicle_status"]
          type: Database["public"]["Enums"]["logistics_vehicle_type"]
          updated_at: string
        }
        Insert: {
          capacity_tons?: number | null
          carrier_id?: string | null
          container_slots?: number | null
          created_at?: string
          id?: string
          insurance_expiry?: string | null
          is_active?: boolean
          make?: string | null
          model?: string | null
          notes?: string | null
          odometer?: number | null
          organization_id?: string
          ownership?: string | null
          registration: string
          status?: Database["public"]["Enums"]["logistics_vehicle_status"]
          type?: Database["public"]["Enums"]["logistics_vehicle_type"]
          updated_at?: string
        }
        Update: {
          capacity_tons?: number | null
          carrier_id?: string | null
          container_slots?: number | null
          created_at?: string
          id?: string
          insurance_expiry?: string | null
          is_active?: boolean
          make?: string | null
          model?: string | null
          notes?: string | null
          odometer?: number | null
          organization_id?: string
          ownership?: string | null
          registration?: string
          status?: Database["public"]["Enums"]["logistics_vehicle_status"]
          type?: Database["public"]["Enums"]["logistics_vehicle_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "logistics_vehicles_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "logistics_carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_vehicles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "logistics_vehicles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      material_movements: {
        Row: {
          conversion_id: string | null
          created_at: string
          created_by: string | null
          goods_receipt_id: string | null
          id: string
          material_id: string
          movement_type: Database["public"]["Enums"]["material_movement_type"]
          note: string | null
          organization_id: string
          planned_qty_snapshot: number | null
          planned_unit_cost_snapshot: number | null
          qty: number
          reason: string | null
          unit_cost: number
        }
        Insert: {
          conversion_id?: string | null
          created_at?: string
          created_by?: string | null
          goods_receipt_id?: string | null
          id?: string
          material_id: string
          movement_type: Database["public"]["Enums"]["material_movement_type"]
          note?: string | null
          organization_id?: string
          planned_qty_snapshot?: number | null
          planned_unit_cost_snapshot?: number | null
          qty: number
          reason?: string | null
          unit_cost?: number
        }
        Update: {
          conversion_id?: string | null
          created_at?: string
          created_by?: string | null
          goods_receipt_id?: string | null
          id?: string
          material_id?: string
          movement_type?: Database["public"]["Enums"]["material_movement_type"]
          note?: string | null
          organization_id?: string
          planned_qty_snapshot?: number | null
          planned_unit_cost_snapshot?: number | null
          qty?: number
          reason?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "material_movements_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_movements_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "material_movements_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "material_stock_reconciliation"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "material_movements_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
        ]
      }
      material_requests: {
        Row: {
          conversion_id: string
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          description: string
          id: string
          material_id: string | null
          needed_by: string | null
          note: string | null
          organization_id: string
          purchase_order_id: string | null
          qty_available_at_request: number
          quantity: number
          status: string
          urgency: string
        }
        Insert: {
          conversion_id: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          description: string
          id?: string
          material_id?: string | null
          needed_by?: string | null
          note?: string | null
          organization_id?: string
          purchase_order_id?: string | null
          qty_available_at_request?: number
          quantity?: number
          status?: string
          urgency?: string
        }
        Update: {
          conversion_id?: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          description?: string
          id?: string
          material_id?: string | null
          needed_by?: string | null
          note?: string | null
          organization_id?: string
          purchase_order_id?: string | null
          qty_available_at_request?: number
          quantity?: number
          status?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_requests_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_requests_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "material_requests_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "material_stock_reconciliation"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "material_requests_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "material_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_requests_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_requests_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_vat_summary"
            referencedColumns: ["purchase_order_id"]
          },
        ]
      }
      material_stock: {
        Row: {
          id: string
          last_updated: string
          material_id: string
          organization_id: string
          qty_available: number
          qty_reserved: number
        }
        Insert: {
          id?: string
          last_updated?: string
          material_id: string
          organization_id?: string
          qty_available?: number
          qty_reserved?: number
        }
        Update: {
          id?: string
          last_updated?: string
          material_id?: string
          organization_id?: string
          qty_available?: number
          qty_reserved?: number
        }
        Relationships: [
          {
            foreignKeyName: "material_stock_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "material_stock_reconciliation"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "material_stock_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_stock_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "material_stock_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      material_stock_reconciliation_log: {
        Row: {
          created_at: string
          id: string
          material_id: string
          material_name: string | null
          new_balance: number | null
          note: string | null
          old_on_hand_qty: number | null
          old_qty_available: number | null
          organization_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          material_id: string
          material_name?: string | null
          new_balance?: number | null
          note?: string | null
          old_on_hand_qty?: number | null
          old_qty_available?: number | null
          organization_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          material_id?: string
          material_name?: string | null
          new_balance?: number | null
          note?: string | null
          old_on_hand_qty?: number | null
          old_qty_available?: number | null
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "material_stock_reconciliation_log_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "material_stock_reconciliation"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "material_stock_reconciliation_log_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
        ]
      }
      materials: {
        Row: {
          avg_unit_cost: number
          category: string | null
          created_at: string
          id: string
          is_active: boolean
          is_vatable: boolean
          merged_into_id: string | null
          name: string
          name_norm: string | null
          on_hand_qty: number
          organization_id: string
          reorder_point: number
          unit: string
          unit_cost: number
        }
        Insert: {
          avg_unit_cost?: number
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_vatable?: boolean
          merged_into_id?: string | null
          name: string
          name_norm?: string | null
          on_hand_qty?: number
          organization_id?: string
          reorder_point?: number
          unit?: string
          unit_cost?: number
        }
        Update: {
          avg_unit_cost?: number
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_vatable?: boolean
          merged_into_id?: string | null
          name?: string
          name_norm?: string | null
          on_hand_qty?: number
          organization_id?: string
          reorder_point?: number
          unit?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "materials_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "material_stock_reconciliation"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "materials_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "materials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      modules_catalog: {
        Row: {
          code: string
          created_at: string
          description: string | null
          is_core: boolean
          monthly_price: number
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          is_core?: boolean
          monthly_price?: number
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          is_core?: boolean
          monthly_price?: number
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      notification_log: {
        Row: {
          channel: string
          created_at: string
          id: string
          message_summary: string
          organization_id: string
          recipient_contact: string
          recipient_name: string
          reference_id: string | null
          reference_type: string | null
          sent_by: string | null
        }
        Insert: {
          channel?: string
          created_at?: string
          id?: string
          message_summary: string
          organization_id?: string
          recipient_contact: string
          recipient_name: string
          reference_id?: string | null
          reference_type?: string | null
          sent_by?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          message_summary?: string
          organization_id?: string
          recipient_contact?: string
          recipient_name?: string
          reference_id?: string | null
          reference_type?: string | null
          sent_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "notification_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          channel: string
          enabled: boolean
          event_category: string
          id: string
          organization_id: string
          updated_at: string
          user_id: string
          whatsapp_phone: string | null
        }
        Insert: {
          channel: string
          enabled?: boolean
          event_category: string
          id?: string
          organization_id: string
          updated_at?: string
          user_id: string
          whatsapp_phone?: string | null
        }
        Update: {
          channel?: string
          enabled?: boolean
          event_category?: string
          id?: string
          organization_id?: string
          updated_at?: string
          user_id?: string
          whatsapp_phone?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          organization_id: string
          reference_id: string | null
          reference_type: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          organization_id?: string
          reference_id?: string | null
          reference_type?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          organization_id?: string
          reference_id?: string | null
          reference_type?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      operating_expense_attachments: {
        Row: {
          created_at: string
          expense_id: string
          extracted_at: string | null
          extracted_data: Json | null
          extraction_model: string | null
          extraction_status: string | null
          file_name: string
          file_size: number | null
          id: string
          label: string
          mime_type: string | null
          organization_id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          expense_id: string
          extracted_at?: string | null
          extracted_data?: Json | null
          extraction_model?: string | null
          extraction_status?: string | null
          file_name: string
          file_size?: number | null
          id?: string
          label?: string
          mime_type?: string | null
          organization_id: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          expense_id?: string
          extracted_at?: string | null
          extracted_data?: Json | null
          extraction_model?: string | null
          extraction_status?: string | null
          file_name?: string
          file_size?: number | null
          id?: string
          label?: string
          mime_type?: string | null
          organization_id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operating_expense_attachments_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "operating_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      operating_expense_lines: {
        Row: {
          amount: number
          category_id: string | null
          conversion_id: string | null
          created_at: string
          depot_id: string | null
          description: string | null
          expense_id: string
          gl_account_id: string
          id: string
          organization_id: string
          project_id: string | null
          tax_amount: number
          tax_code_id: string | null
        }
        Insert: {
          amount?: number
          category_id?: string | null
          conversion_id?: string | null
          created_at?: string
          depot_id?: string | null
          description?: string | null
          expense_id: string
          gl_account_id: string
          id?: string
          organization_id?: string
          project_id?: string | null
          tax_amount?: number
          tax_code_id?: string | null
        }
        Update: {
          amount?: number
          category_id?: string | null
          conversion_id?: string | null
          created_at?: string
          depot_id?: string | null
          description?: string | null
          expense_id?: string
          gl_account_id?: string
          id?: string
          organization_id?: string
          project_id?: string | null
          tax_amount?: number
          tax_code_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operating_expense_lines_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_expense_lines_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_expense_lines_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "operating_expense_lines_depot_id_fkey"
            columns: ["depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_expense_lines_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "operating_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_expense_lines_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_expense_lines_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["gl_account_id"]
          },
          {
            foreignKeyName: "operating_expense_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "operating_expense_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_expense_lines_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      operating_expenses: {
        Row: {
          amount_paid: number
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          attachment_url: string | null
          conversion_id: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          depot_id: string | null
          due_date: string | null
          expense_date: string
          expense_number: string
          financial_account_id: string | null
          fx_rate: number
          id: string
          journal_id: string | null
          notes: string | null
          organization_id: string
          payee: string | null
          payment_mode: string
          posted_at: string | null
          project_id: string | null
          reference: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          subtotal: number
          supplier_id: string | null
          tax_amount: number
          total_amount: number
          updated_at: string
        }
        Insert: {
          amount_paid?: number
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          attachment_url?: string | null
          conversion_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          depot_id?: string | null
          due_date?: string | null
          expense_date?: string
          expense_number: string
          financial_account_id?: string | null
          fx_rate?: number
          id?: string
          journal_id?: string | null
          notes?: string | null
          organization_id?: string
          payee?: string | null
          payment_mode?: string
          posted_at?: string | null
          project_id?: string | null
          reference?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          subtotal?: number
          supplier_id?: string | null
          tax_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Update: {
          amount_paid?: number
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          attachment_url?: string | null
          conversion_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          depot_id?: string | null
          due_date?: string | null
          expense_date?: string
          expense_number?: string
          financial_account_id?: string | null
          fx_rate?: number
          id?: string
          journal_id?: string | null
          notes?: string | null
          organization_id?: string
          payee?: string | null
          payment_mode?: string
          posted_at?: string | null
          project_id?: string | null
          reference?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          subtotal?: number
          supplier_id?: string | null
          tax_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operating_expenses_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_expenses_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "operating_expenses_depot_id_fkey"
            columns: ["depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_expenses_financial_account_id_fkey"
            columns: ["financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "operating_expenses_financial_account_id_fkey"
            columns: ["financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_expenses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "operating_expenses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_expenses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      org_container_sequences: {
        Row: {
          kind: string
          last_value: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          kind?: string
          last_value?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          kind?: string
          last_value?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      org_lifecycle_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          details: Json
          event_type: string
          id: string
          organization_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          event_type: string
          id?: string
          organization_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_lifecycle_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "org_lifecycle_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["org_member_role"]
          status: Database["public"]["Enums"]["org_member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["org_member_role"]
          status?: Database["public"]["Enums"]["org_member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["org_member_role"]
          status?: Database["public"]["Enums"]["org_member_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          billing_address: Json | null
          billing_email: string | null
          config: Json
          container_prefix: string | null
          country: string | null
          created_at: string
          currency: string
          free_seat_limit: number
          holiday_multiplier: number
          id: string
          logo_url: string | null
          name: string
          owner_user_id: string | null
          slug: string
          status: Database["public"]["Enums"]["org_status"]
          tax_id: string | null
          timezone: string
          trial_ends_at: string
          updated_at: string
        }
        Insert: {
          billing_address?: Json | null
          billing_email?: string | null
          config?: Json
          container_prefix?: string | null
          country?: string | null
          created_at?: string
          currency?: string
          free_seat_limit?: number
          holiday_multiplier?: number
          id?: string
          logo_url?: string | null
          name: string
          owner_user_id?: string | null
          slug: string
          status?: Database["public"]["Enums"]["org_status"]
          tax_id?: string | null
          timezone?: string
          trial_ends_at?: string
          updated_at?: string
        }
        Update: {
          billing_address?: Json | null
          billing_email?: string | null
          config?: Json
          container_prefix?: string | null
          country?: string | null
          created_at?: string
          currency?: string
          free_seat_limit?: number
          holiday_multiplier?: number
          id?: string
          logo_url?: string | null
          name?: string
          owner_user_id?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["org_status"]
          tax_id?: string | null
          timezone?: string
          trial_ends_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_allocation_requests: {
        Row: {
          amount: number
          approval_request_id: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          deviates_from_proposal: boolean
          id: string
          organization_id: string
          payment_id: string
          proposal: Json
          reason: string | null
          requested_allocations: Json
          status: string
          supplier_id: string
        }
        Insert: {
          amount: number
          approval_request_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          deviates_from_proposal?: boolean
          id?: string
          organization_id: string
          payment_id: string
          proposal?: Json
          reason?: string | null
          requested_allocations?: Json
          status?: string
          supplier_id: string
        }
        Update: {
          amount?: number
          approval_request_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          deviates_from_proposal?: boolean
          id?: string
          organization_id?: string
          payment_id?: string
          proposal?: Json
          reason?: string | null
          requested_allocations?: Json
          status?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocation_requests_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_unallocated_vendor_payments"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_allocation_requests_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "vendor_payment_unallocated"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_allocation_requests_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "vendor_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocation_requests_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_allocations: {
        Row: {
          amount: number
          created_at: string
          id: string
          invoice_id: string
          organization_id: string
          payment_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          invoice_id: string
          organization_id?: string
          payment_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          invoice_id?: string
          organization_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "payment_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          approval_request_id: string | null
          approval_status: Database["public"]["Enums"]["approval_doc_status"]
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          financial_account_id: string | null
          id: string
          invoice_id: string
          notes: string | null
          organization_id: string
          paid_at: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_number: string
          project_id: string | null
          recorded_by: string | null
          reference_number: string | null
          rejection_reason: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          reversed_payment_id: string | null
        }
        Insert: {
          amount: number
          approval_request_id?: string | null
          approval_status?: Database["public"]["Enums"]["approval_doc_status"]
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          financial_account_id?: string | null
          id?: string
          invoice_id: string
          notes?: string | null
          organization_id?: string
          paid_at?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_number: string
          project_id?: string | null
          recorded_by?: string | null
          reference_number?: string | null
          rejection_reason?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          reversed_payment_id?: string | null
        }
        Update: {
          amount?: number
          approval_request_id?: string | null
          approval_status?: Database["public"]["Enums"]["approval_doc_status"]
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          financial_account_id?: string | null
          id?: string
          invoice_id?: string
          notes?: string | null
          organization_id?: string
          paid_at?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_number?: string
          project_id?: string | null
          recorded_by?: string | null
          reference_number?: string | null
          rejection_reason?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          reversed_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_financial_account_id_fkey"
            columns: ["financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "payments_financial_account_id_fkey"
            columns: ["financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "payments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_reversed_payment_id_fkey"
            columns: ["reversed_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_run_items: {
        Row: {
          action: string
          created_at: string
          error: string | null
          id: string
          payslip_id: string
          run_id: string
        }
        Insert: {
          action: string
          created_at?: string
          error?: string | null
          id?: string
          payslip_id: string
          run_id: string
        }
        Update: {
          action?: string
          created_at?: string
          error?: string | null
          id?: string
          payslip_id?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_run_items_payslip_id_fkey"
            columns: ["payslip_id"]
            isOneToOne: false
            referencedRelation: "payslips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_run_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          division: string | null
          error_log: Json
          failed_count: number
          id: string
          idempotency_key: string
          organization_id: string
          pending_approval_count: number
          period_end: string
          period_start: string
          posted_count: number
          started_at: string
          status: string
          total_payslips: number
          triggered_by: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          division?: string | null
          error_log?: Json
          failed_count?: number
          id?: string
          idempotency_key: string
          organization_id?: string
          pending_approval_count?: number
          period_end: string
          period_start: string
          posted_count?: number
          started_at?: string
          status?: string
          total_payslips?: number
          triggered_by?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          division?: string | null
          error_log?: Json
          failed_count?: number
          id?: string
          idempotency_key?: string
          organization_id?: string
          pending_approval_count?: number
          period_end?: string
          period_start?: string
          posted_count?: number
          started_at?: string
          status?: string
          total_payslips?: number
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "payroll_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payslip_lines: {
        Row: {
          amount: number
          id: string
          label: string
          line_type: string
          payslip_id: string
          sort_order: number
          taxable: boolean
        }
        Insert: {
          amount?: number
          id?: string
          label: string
          line_type: string
          payslip_id: string
          sort_order?: number
          taxable?: boolean
        }
        Update: {
          amount?: number
          id?: string
          label?: string
          line_type?: string
          payslip_id?: string
          sort_order?: number
          taxable?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "payslip_lines_payslip_id_fkey"
            columns: ["payslip_id"]
            isOneToOne: false
            referencedRelation: "payslips"
            referencedColumns: ["id"]
          },
        ]
      }
      payslip_pdf_settings: {
        Row: {
          accent_color: string
          created_at: string
          currency_code: string
          currency_position: string
          currency_symbol: string
          decimal_places: number
          footer_text: string | null
          header_address: string | null
          id: string
          language: string | null
          logo_url: string | null
          organization_id: string
          show_qr: boolean
          signature_block_text: string | null
          updated_at: string
        }
        Insert: {
          accent_color?: string
          created_at?: string
          currency_code?: string
          currency_position?: string
          currency_symbol?: string
          decimal_places?: number
          footer_text?: string | null
          header_address?: string | null
          id?: string
          language?: string | null
          logo_url?: string | null
          organization_id?: string
          show_qr?: boolean
          signature_block_text?: string | null
          updated_at?: string
        }
        Update: {
          accent_color?: string
          created_at?: string
          currency_code?: string
          currency_position?: string
          currency_symbol?: string
          decimal_places?: number
          footer_text?: string | null
          header_address?: string | null
          id?: string
          language?: string | null
          logo_url?: string | null
          organization_id?: string
          show_qr?: boolean
          signature_block_text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payslip_pdf_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "payslip_pdf_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payslips: {
        Row: {
          accounting_transaction_id: string | null
          approval_comment: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          employee_id: string
          gross_pay: number
          id: string
          net_pay: number
          notes: string | null
          organization_id: string
          paid_at: string | null
          paid_from_account_id: string | null
          pay_date: string
          period_end: string
          period_start: string
          posted_at: string | null
          posting_mode: string
          reference: string
          status: string
          submitted_by: string | null
          submitted_for_approval_at: string | null
          total_contributions: number
          total_deductions: number
          updated_at: string
        }
        Insert: {
          accounting_transaction_id?: string | null
          approval_comment?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          employee_id: string
          gross_pay?: number
          id?: string
          net_pay?: number
          notes?: string | null
          organization_id?: string
          paid_at?: string | null
          paid_from_account_id?: string | null
          pay_date: string
          period_end: string
          period_start: string
          posted_at?: string | null
          posting_mode?: string
          reference?: string
          status?: string
          submitted_by?: string | null
          submitted_for_approval_at?: string | null
          total_contributions?: number
          total_deductions?: number
          updated_at?: string
        }
        Update: {
          accounting_transaction_id?: string | null
          approval_comment?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          employee_id?: string
          gross_pay?: number
          id?: string
          net_pay?: number
          notes?: string | null
          organization_id?: string
          paid_at?: string | null
          paid_from_account_id?: string | null
          pay_date?: string
          period_end?: string
          period_start?: string
          posted_at?: string | null
          posting_mode?: string
          reference?: string
          status?: string
          submitted_by?: string | null
          submitted_for_approval_at?: string | null
          total_contributions?: number
          total_deductions?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payslips_accounting_transaction_id_fkey"
            columns: ["accounting_transaction_id"]
            isOneToOne: false
            referencedRelation: "accounting_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_accounting_transaction_id_fkey"
            columns: ["accounting_transaction_id"]
            isOneToOne: false
            referencedRelation: "currency_integrity_exceptions"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "payslips_accounting_transaction_id_fkey"
            columns: ["accounting_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_expense_journal_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "payslips_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_payroll_status"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "payslips_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "payslips_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_paid_from_account_id_fkey"
            columns: ["paid_from_account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "payslips_paid_from_account_id_fkey"
            columns: ["paid_from_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      period_close_checklist: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          notes: string | null
          organization_id: string
          owner_user_id: string | null
          period_id: string
          sequence: number
          status: string
          task: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          owner_user_id?: string | null
          period_id: string
          sequence?: number
          status?: string
          task: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          owner_user_id?: string | null
          period_id?: string
          sequence?: number
          status?: string
          task?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "period_close_checklist_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "fiscal_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      petty_cash_floats: {
        Row: {
          account_id: string | null
          created_at: string
          current_balance: number
          custodian_id: string | null
          id: string
          name: string
          opening_balance: number
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          current_balance?: number
          custodian_id?: string | null
          id?: string
          name: string
          opening_balance?: number
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          current_balance?: number
          custodian_id?: string | null
          id?: string
          name?: string
          opening_balance?: number
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_floats_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "petty_cash_floats_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      petty_cash_vouchers: {
        Row: {
          amount: number
          created_at: string
          float_id: string
          gl_account_id: string | null
          id: string
          notes: string | null
          organization_id: string
          payee: string | null
          receipt_url: string | null
          voucher_date: string
          voucher_number: string
        }
        Insert: {
          amount?: number
          created_at?: string
          float_id: string
          gl_account_id?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          payee?: string | null
          receipt_url?: string | null
          voucher_date?: string
          voucher_number: string
        }
        Update: {
          amount?: number
          created_at?: string
          float_id?: string
          gl_account_id?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          payee?: string | null
          receipt_url?: string | null
          voucher_date?: string
          voucher_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_vouchers_float_id_fkey"
            columns: ["float_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_floats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_vouchers_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_vouchers_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["gl_account_id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_invoice_lines: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          line_type: Database["public"]["Enums"]["platform_invoice_line_type"]
          module_code: string | null
          quantity: number
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          line_type: Database["public"]["Enums"]["platform_invoice_line_type"]
          module_code?: string | null
          quantity?: number
          total?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          line_type?: Database["public"]["Enums"]["platform_invoice_line_type"]
          module_code?: string | null
          quantity?: number
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "platform_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_invoice_runs: {
        Row: {
          created_at: string
          id: string
          org_count: number
          period_end: string
          period_start: string
          total_amount: number
          triggered_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          org_count?: number
          period_end: string
          period_start: string
          total_amount?: number
          triggered_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          org_count?: number
          period_end?: string
          period_start?: string
          total_amount?: number
          triggered_by?: string | null
        }
        Relationships: []
      }
      platform_invoices: {
        Row: {
          base_fee: number
          created_at: string
          currency: string
          due_at: string | null
          id: string
          invoice_number: string
          issued_at: string
          modules_total: number
          notes: string | null
          organization_id: string
          paid_at: string | null
          period_end: string
          period_start: string
          seat_count: number
          seat_fee: number
          seats_total: number
          sent_at: string | null
          status: Database["public"]["Enums"]["platform_invoice_status"]
          stripe_hosted_url: string | null
          stripe_invoice_id: string | null
          stripe_pdf_url: string | null
          subtotal: number
          tax_amount: number
          total: number
          updated_at: string
        }
        Insert: {
          base_fee?: number
          created_at?: string
          currency?: string
          due_at?: string | null
          id?: string
          invoice_number: string
          issued_at?: string
          modules_total?: number
          notes?: string | null
          organization_id: string
          paid_at?: string | null
          period_end: string
          period_start: string
          seat_count?: number
          seat_fee?: number
          seats_total?: number
          sent_at?: string | null
          status?: Database["public"]["Enums"]["platform_invoice_status"]
          stripe_hosted_url?: string | null
          stripe_invoice_id?: string | null
          stripe_pdf_url?: string | null
          subtotal?: number
          tax_amount?: number
          total?: number
          updated_at?: string
        }
        Update: {
          base_fee?: number
          created_at?: string
          currency?: string
          due_at?: string | null
          id?: string
          invoice_number?: string
          issued_at?: string
          modules_total?: number
          notes?: string | null
          organization_id?: string
          paid_at?: string | null
          period_end?: string
          period_start?: string
          seat_count?: number
          seat_fee?: number
          seats_total?: number
          sent_at?: string | null
          status?: Database["public"]["Enums"]["platform_invoice_status"]
          stripe_hosted_url?: string | null
          stripe_invoice_id?: string | null
          stripe_pdf_url?: string | null
          subtotal?: number
          tax_amount?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "platform_invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      po_items: {
        Row: {
          allocated_freight: number
          created_at: string
          description: string
          id: string
          is_vatable: boolean
          landed_unit_cost: number
          material_id: string | null
          net_amount: number
          organization_id: string
          po_id: string
          quantity: number
          received_qty: number
          tax_amount: number
          tax_code_id: string | null
          tax_rate: number
          total_cost: number
          unit_price: number
        }
        Insert: {
          allocated_freight?: number
          created_at?: string
          description: string
          id?: string
          is_vatable?: boolean
          landed_unit_cost?: number
          material_id?: string | null
          net_amount?: number
          organization_id?: string
          po_id: string
          quantity?: number
          received_qty?: number
          tax_amount?: number
          tax_code_id?: string | null
          tax_rate?: number
          total_cost?: number
          unit_price?: number
        }
        Update: {
          allocated_freight?: number
          created_at?: string
          description?: string
          id?: string
          is_vatable?: boolean
          landed_unit_cost?: number
          material_id?: string | null
          net_amount?: number
          organization_id?: string
          po_id?: string
          quantity?: number
          received_qty?: number
          tax_amount?: number
          tax_code_id?: string | null
          tax_rate?: number
          total_cost?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "po_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "material_stock_reconciliation"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "po_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "po_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_vat_summary"
            referencedColumns: ["purchase_order_id"]
          },
          {
            foreignKeyName: "po_items_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      po_status_events: {
        Row: {
          changed_by: string | null
          created_at: string
          from_status: string | null
          id: string
          is_admin_reset: boolean
          organization_id: string
          purchase_order_id: string
          reason: string | null
          to_status: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          is_admin_reset?: boolean
          organization_id: string
          purchase_order_id: string
          reason?: string | null
          to_status: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          is_admin_reset?: boolean
          organization_id?: string
          purchase_order_id?: string
          reason?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "po_status_events_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_status_events_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_vat_summary"
            referencedColumns: ["purchase_order_id"]
          },
        ]
      }
      products: {
        Row: {
          base_price: number | null
          category: string | null
          cover_image_url: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          gallery: Json
          id: string
          is_published: boolean
          long_description: string | null
          name: string
          organization_id: string
          short_description: string | null
          slug: string
          sort_order: number
          source_template_id: string | null
          specs: Json
          updated_at: string
        }
        Insert: {
          base_price?: number | null
          category?: string | null
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          gallery?: Json
          id?: string
          is_published?: boolean
          long_description?: string | null
          name: string
          organization_id?: string
          short_description?: string | null
          slug: string
          sort_order?: number
          source_template_id?: string | null
          specs?: Json
          updated_at?: string
        }
        Update: {
          base_price?: number | null
          category?: string | null
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          gallery?: Json
          id?: string
          is_published?: boolean
          long_description?: string | null
          name?: string
          organization_id?: string
          short_description?: string | null
          slug?: string
          sort_order?: number
          source_template_id?: string | null
          specs?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_source_template_id_fkey"
            columns: ["source_template_id"]
            isOneToOne: false
            referencedRelation: "quote_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          approval_limits: Json
          created_at: string
          default_depot_id: string | null
          display_name: string | null
          id: string
          manager_id: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          approval_limits?: Json
          created_at?: string
          default_depot_id?: string | null
          display_name?: string | null
          id?: string
          manager_id?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          approval_limits?: Json
          created_at?: string
          default_depot_id?: string | null
          display_name?: string | null
          id?: string
          manager_id?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_default_depot_id_fkey"
            columns: ["default_depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          budget_amount: number
          code: string
          created_at: string
          created_by: string | null
          currency: string | null
          customer_id: string | null
          description: string | null
          end_date: string | null
          id: string
          manager_user_id: string | null
          name: string
          organization_id: string
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          budget_amount?: number
          code: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customer_id?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          manager_user_id?: string | null
          name: string
          organization_id?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          budget_amount?: number
          code?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customer_id?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          manager_user_id?: string | null
          name?: string
          organization_id?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      public_holidays: {
        Row: {
          created_at: string
          holiday_date: string
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          holiday_date: string
          id?: string
          name: string
          organization_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          holiday_date?: string
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      public_request_log: {
        Row: {
          created_at: string
          email_hash: string | null
          endpoint: string
          id: number
          ip_hash: string
          organization_id: string | null
        }
        Insert: {
          created_at?: string
          email_hash?: string | null
          endpoint: string
          id?: number
          ip_hash: string
          organization_id?: string | null
        }
        Update: {
          created_at?: string
          email_hash?: string | null
          endpoint?: string
          id?: number
          ip_hash?: string
          organization_id?: string | null
        }
        Relationships: []
      }
      purchase_orders: {
        Row: {
          approval_request_id: string | null
          approval_status: Database["public"]["Enums"]["approval_doc_status"]
          approved_at: string | null
          approved_by: string | null
          conversion_id: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          freight_amount: number
          id: string
          landed_total: number
          order_date: string
          organization_id: string
          other_charges_amount: number
          po_number: string
          prices_include_tax: boolean
          project_id: string | null
          recipient_resolution_note: string | null
          recipient_source: string | null
          rejection_reason: string | null
          resolved_container_id: string | null
          status: string
          subtotal: number
          supplier_id: string
          supplier_ref: string | null
          tax_code_id: string | null
          tax_total: number
          total_cost: number
        }
        Insert: {
          approval_request_id?: string | null
          approval_status?: Database["public"]["Enums"]["approval_doc_status"]
          approved_at?: string | null
          approved_by?: string | null
          conversion_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          freight_amount?: number
          id?: string
          landed_total?: number
          order_date?: string
          organization_id?: string
          other_charges_amount?: number
          po_number: string
          prices_include_tax?: boolean
          project_id?: string | null
          recipient_resolution_note?: string | null
          recipient_source?: string | null
          rejection_reason?: string | null
          resolved_container_id?: string | null
          status?: string
          subtotal?: number
          supplier_id: string
          supplier_ref?: string | null
          tax_code_id?: string | null
          tax_total?: number
          total_cost?: number
        }
        Update: {
          approval_request_id?: string | null
          approval_status?: Database["public"]["Enums"]["approval_doc_status"]
          approved_at?: string | null
          approved_by?: string | null
          conversion_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          freight_amount?: number
          id?: string
          landed_total?: number
          order_date?: string
          organization_id?: string
          other_charges_amount?: number
          po_number?: string
          prices_include_tax?: boolean
          project_id?: string | null
          recipient_resolution_note?: string | null
          recipient_source?: string | null
          rejection_reason?: string | null
          resolved_container_id?: string | null
          status?: string
          subtotal?: number
          supplier_id?: string
          supplier_ref?: string | null
          tax_code_id?: string | null
          tax_total?: number
          total_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "purchase_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "purchase_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "purchase_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          conversion_id: string
          created_at: string
          description: string
          id: string
          organization_id: string
          quantity: number
          supplier: string
          total_cost: number
          unit_price: number
        }
        Insert: {
          conversion_id: string
          created_at?: string
          description: string
          id?: string
          organization_id?: string
          quantity?: number
          supplier: string
          total_cost?: number
          unit_price?: number
        }
        Update: {
          conversion_id?: string
          created_at?: string
          description?: string
          id?: string
          organization_id?: string
          quantity?: number
          supplier?: string
          total_cost?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchases_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "purchases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "purchases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      push_notification_queue: {
        Row: {
          channel: string
          created_at: string
          error: string | null
          id: string
          notification_id: string | null
          payload: Json
          recipient: string
          sent_at: string | null
          status: string
        }
        Insert: {
          channel: string
          created_at?: string
          error?: string | null
          id?: string
          notification_id?: string | null
          payload?: Json
          recipient: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          notification_id?: string | null
          payload?: Json
          recipient?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_notification_queue_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      quote_deletion_audit: {
        Row: {
          created_at: string
          customer_name: string | null
          deleted_by: string | null
          id: string
          organization_id: string
          quote_id: string
          quote_number: string
          reason: string
          snapshot: Json
          total_amount: number
        }
        Insert: {
          created_at?: string
          customer_name?: string | null
          deleted_by?: string | null
          id?: string
          organization_id?: string
          quote_id: string
          quote_number: string
          reason: string
          snapshot?: Json
          total_amount?: number
        }
        Update: {
          created_at?: string
          customer_name?: string | null
          deleted_by?: string | null
          id?: string
          organization_id?: string
          quote_id?: string
          quote_number?: string
          reason?: string
          snapshot?: Json
          total_amount?: number
        }
        Relationships: []
      }
      quote_items: {
        Row: {
          created_at: string
          description: string
          discount_pct: number
          id: string
          item_kind: string
          item_type: string
          organization_id: string
          quantity: number
          quote_id: string
          ref_id: string | null
          ref_table: string | null
          section_id: string | null
          sort_order: number
          tax_pct: number
          total_price: number
          unit: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          discount_pct?: number
          id?: string
          item_kind?: string
          item_type?: string
          organization_id?: string
          quantity?: number
          quote_id: string
          ref_id?: string | null
          ref_table?: string | null
          section_id?: string | null
          sort_order?: number
          tax_pct?: number
          total_price?: number
          unit?: string | null
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string
          discount_pct?: number
          id?: string
          item_kind?: string
          item_type?: string
          organization_id?: string
          quantity?: number
          quote_id?: string
          ref_id?: string | null
          ref_table?: string | null
          section_id?: string | null
          sort_order?: number
          tax_pct?: number
          total_price?: number
          unit?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "quote_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "quote_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_sections: {
        Row: {
          created_at: string
          id: string
          kind: string
          notes: string | null
          organization_id: string
          quote_id: string
          sort_order: number
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          notes?: string | null
          organization_id?: string
          quote_id: string
          sort_order?: number
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          notes?: string | null
          organization_id?: string
          quote_id?: string
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_sections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "quote_sections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_sections_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_service_catalog: {
        Row: {
          category: string
          created_at: string
          default_price: number
          id: string
          is_active: boolean
          name: string
          organization_id: string
          unit: string
        }
        Insert: {
          category?: string
          created_at?: string
          default_price?: number
          id?: string
          is_active?: boolean
          name: string
          organization_id?: string
          unit?: string
        }
        Update: {
          category?: string
          created_at?: string
          default_price?: number
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_service_catalog_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "quote_service_catalog_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_template_items: {
        Row: {
          created_at: string
          default_quantity: number
          default_unit_price: number
          description: string
          discount_pct: number
          id: string
          item_kind: string
          item_type: string
          organization_id: string
          ref_id: string | null
          ref_table: string | null
          section_id: string
          sort_order: number
          tax_pct: number
          template_id: string
          unit: string | null
        }
        Insert: {
          created_at?: string
          default_quantity?: number
          default_unit_price?: number
          description: string
          discount_pct?: number
          id?: string
          item_kind?: string
          item_type?: string
          organization_id?: string
          ref_id?: string | null
          ref_table?: string | null
          section_id: string
          sort_order?: number
          tax_pct?: number
          template_id: string
          unit?: string | null
        }
        Update: {
          created_at?: string
          default_quantity?: number
          default_unit_price?: number
          description?: string
          discount_pct?: number
          id?: string
          item_kind?: string
          item_type?: string
          organization_id?: string
          ref_id?: string | null
          ref_table?: string | null
          section_id?: string
          sort_order?: number
          tax_pct?: number
          template_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_template_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "quote_template_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_template_items_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "quote_template_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "quote_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_template_sections: {
        Row: {
          created_at: string
          id: string
          kind: string
          notes: string | null
          organization_id: string
          sort_order: number
          template_id: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          notes?: string | null
          organization_id?: string
          sort_order?: number
          template_id: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          notes?: string | null
          organization_id?: string
          sort_order?: number
          template_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_template_sections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "quote_template_sections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_template_sections_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "quote_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_template_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          organization_id: string
          payload: Json
          template_id: string
          version_no: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          organization_id?: string
          payload: Json
          template_id: string
          version_no: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          organization_id?: string
          payload?: Json
          template_id?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_template_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "quote_template_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "quote_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_template_visuals: {
        Row: {
          caption: string | null
          created_at: string
          created_by: string | null
          id: string
          image_url: string
          kind: string
          organization_id: string
          section_id: string | null
          sort_order: number
          template_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          image_url: string
          kind?: string
          organization_id?: string
          section_id?: string | null
          sort_order?: number
          template_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          image_url?: string
          kind?: string
          organization_id?: string
          section_id?: string | null
          sort_order?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_template_visuals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "quote_template_visuals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_template_visuals_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "quote_template_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_template_visuals_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "quote_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_templates: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          default_notes: string | null
          default_terms: string | null
          default_validity_days: number | null
          description: string | null
          id: string
          is_active: boolean
          kind: string
          name: string
          organization_id: string
          reference_file_kind: string | null
          reference_file_name: string | null
          reference_file_url: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          default_notes?: string | null
          default_terms?: string | null
          default_validity_days?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name: string
          organization_id?: string
          reference_file_kind?: string | null
          reference_file_name?: string | null
          reference_file_url?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          default_notes?: string | null
          default_terms?: string | null
          default_validity_days?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          organization_id?: string
          reference_file_kind?: string | null
          reference_file_name?: string | null
          reference_file_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "quote_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_versions: {
        Row: {
          created_at: string
          created_by: string | null
          event: string
          id: string
          note: string | null
          organization_id: string
          quote_id: string
          snapshot: Json
          total_amount: number
          version_no: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event: string
          id?: string
          note?: string | null
          organization_id?: string
          quote_id: string
          snapshot: Json
          total_amount?: number
          version_no: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event?: string
          id?: string
          note?: string | null
          organization_id?: string
          quote_id?: string
          snapshot?: Json
          total_amount?: number
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "quote_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_versions_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_visual_library: {
        Row: {
          caption: string | null
          category: string | null
          created_at: string
          created_by: string | null
          id: string
          image_url: string
          is_active: boolean
          kind: string
          organization_id: string
          tags: string[] | null
          title: string
          updated_at: string
        }
        Insert: {
          caption?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          image_url: string
          is_active?: boolean
          kind?: string
          organization_id?: string
          tags?: string[] | null
          title: string
          updated_at?: string
        }
        Update: {
          caption?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          image_url?: string
          is_active?: boolean
          kind?: string
          organization_id?: string
          tags?: string[] | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_visual_library_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "quote_visual_library_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_visuals: {
        Row: {
          caption: string | null
          created_at: string
          created_by: string | null
          id: string
          image_url: string
          kind: string
          organization_id: string
          quote_id: string
          section_id: string | null
          sort_order: number
          source: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          image_url: string
          kind?: string
          organization_id?: string
          quote_id: string
          section_id?: string | null
          sort_order?: number
          source?: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          image_url?: string
          kind?: string
          organization_id?: string
          quote_id?: string
          section_id?: string | null
          sort_order?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_visuals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "quote_visuals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_visuals_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_visuals_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "quote_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          approval_request_id: string | null
          approval_status: Database["public"]["Enums"]["approval_doc_status"]
          approved_at: string | null
          approved_by: string | null
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          deal_id: string | null
          id: string
          notes: string | null
          organization_id: string
          project_id: string | null
          quote_number: string
          rejection_reason: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          total_amount: number
          valid_until: string | null
        }
        Insert: {
          approval_request_id?: string | null
          approval_status?: Database["public"]["Enums"]["approval_doc_status"]
          approved_at?: string | null
          approved_by?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          deal_id?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          project_id?: string | null
          quote_number: string
          rejection_reason?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          total_amount?: number
          valid_until?: string | null
        }
        Update: {
          approval_request_id?: string | null
          approval_status?: Database["public"]["Enums"]["approval_doc_status"]
          approved_at?: string | null
          approved_by?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          deal_id?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          project_id?: string | null
          quote_number?: string
          rejection_reason?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          total_amount?: number
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "quotes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quotes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_expense_runs: {
        Row: {
          created_at: string
          expense_id: string | null
          id: string
          message: string | null
          organization_id: string
          period_key: string
          run_date: string
          status: string
          template_id: string
          triggered_by: string | null
        }
        Insert: {
          created_at?: string
          expense_id?: string | null
          id?: string
          message?: string | null
          organization_id: string
          period_key: string
          run_date?: string
          status?: string
          template_id: string
          triggered_by?: string | null
        }
        Update: {
          created_at?: string
          expense_id?: string | null
          id?: string
          message?: string | null
          organization_id?: string
          period_key?: string
          run_date?: string
          status?: string
          template_id?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expense_runs_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "operating_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expense_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "recurring_expense_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_expense_template_lines: {
        Row: {
          amount: number
          category_id: string | null
          created_at: string
          depot_id: string | null
          description: string | null
          gl_account_id: string
          id: string
          organization_id: string
          project_id: string | null
          sort_order: number
          tax_code_id: string | null
          template_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          category_id?: string | null
          created_at?: string
          depot_id?: string | null
          description?: string | null
          gl_account_id: string
          id?: string
          organization_id: string
          project_id?: string | null
          sort_order?: number
          tax_code_id?: string | null
          template_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category_id?: string | null
          created_at?: string
          depot_id?: string | null
          description?: string | null
          gl_account_id?: string
          id?: string
          organization_id?: string
          project_id?: string | null
          sort_order?: number
          tax_code_id?: string | null
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expense_template_lines_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expense_template_lines_depot_id_fkey"
            columns: ["depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expense_template_lines_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expense_template_lines_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["gl_account_id"]
          },
          {
            foreignKeyName: "recurring_expense_template_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "recurring_expense_template_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expense_template_lines_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expense_template_lines_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "recurring_expense_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_expense_templates: {
        Row: {
          auto_submit: boolean
          created_at: string
          created_by: string | null
          currency: string | null
          day_of_month: number
          depot_id: string | null
          due_days: number
          end_date: string | null
          financial_account_id: string | null
          frequency: string
          id: string
          interval_count: number
          is_active: boolean
          last_run_at: string | null
          name: string
          next_run_date: string
          notes: string | null
          organization_id: string
          payee: string | null
          payment_mode: string
          project_id: string | null
          reference: string | null
          start_date: string
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          auto_submit?: boolean
          created_at?: string
          created_by?: string | null
          currency?: string | null
          day_of_month?: number
          depot_id?: string | null
          due_days?: number
          end_date?: string | null
          financial_account_id?: string | null
          frequency?: string
          id?: string
          interval_count?: number
          is_active?: boolean
          last_run_at?: string | null
          name: string
          next_run_date?: string
          notes?: string | null
          organization_id: string
          payee?: string | null
          payment_mode?: string
          project_id?: string | null
          reference?: string | null
          start_date?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          auto_submit?: boolean
          created_at?: string
          created_by?: string | null
          currency?: string | null
          day_of_month?: number
          depot_id?: string | null
          due_days?: number
          end_date?: string | null
          financial_account_id?: string | null
          frequency?: string
          id?: string
          interval_count?: number
          is_active?: boolean
          last_run_at?: string | null
          name?: string
          next_run_date?: string
          notes?: string | null
          organization_id?: string
          payee?: string | null
          payment_mode?: string
          project_id?: string | null
          reference?: string | null
          start_date?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expense_templates_depot_id_fkey"
            columns: ["depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expense_templates_financial_account_id_fkey"
            columns: ["financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "recurring_expense_templates_financial_account_id_fkey"
            columns: ["financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expense_templates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "recurring_expense_templates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expense_templates_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_invoice_runs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          invoice_id: string | null
          organization_id: string
          run_date: string
          status: string
          template_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          invoice_id?: string | null
          organization_id?: string
          run_date: string
          status?: string
          template_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          invoice_id?: string | null
          organization_id?: string
          run_date?: string
          status?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_invoice_runs_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoice_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "recurring_invoice_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoice_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "recurring_invoice_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_invoice_templates: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string | null
          customer_name: string
          customer_reference: string | null
          due_days: number
          end_date: string | null
          frequency: string
          id: string
          interval_count: number
          invoice_type: Database["public"]["Enums"]["charge_type"]
          last_run_at: string | null
          line_items: Json
          name: string
          next_run_date: string
          notes: string | null
          organization_id: string
          status: string
          subtotal: number
          tax_rate: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customer_name: string
          customer_reference?: string | null
          due_days?: number
          end_date?: string | null
          frequency: string
          id?: string
          interval_count?: number
          invoice_type?: Database["public"]["Enums"]["charge_type"]
          last_run_at?: string | null
          line_items?: Json
          name: string
          next_run_date: string
          notes?: string | null
          organization_id?: string
          status?: string
          subtotal?: number
          tax_rate?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customer_name?: string
          customer_reference?: string | null
          due_days?: number
          end_date?: string | null
          frequency?: string
          id?: string
          interval_count?: number
          invoice_type?: Database["public"]["Enums"]["charge_type"]
          last_run_at?: string | null
          line_items?: Json
          name?: string
          next_run_date?: string
          notes?: string | null
          organization_id?: string
          status?: string
          subtotal?: number
          tax_rate?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_invoice_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "recurring_invoice_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_transfer_runs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          organization_id: string
          ran_at: string
          recurring_transfer_id: string
          scheduled_for: string
          status: string
          transfer_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          organization_id?: string
          ran_at?: string
          recurring_transfer_id: string
          scheduled_for: string
          status: string
          transfer_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          organization_id?: string
          ran_at?: string
          recurring_transfer_id?: string
          scheduled_for?: string
          status?: string
          transfer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_transfer_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "recurring_transfer_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transfer_runs_recurring_transfer_id_fkey"
            columns: ["recurring_transfer_id"]
            isOneToOne: false
            referencedRelation: "recurring_transfers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transfer_runs_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "inter_account_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_transfers: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string | null
          fees: number
          frequency: string
          from_account_id: string
          fx_rate: number
          id: string
          interval_count: number
          last_run_at: string | null
          name: string
          next_run_at: string
          organization_id: string
          reference: string | null
          start_date: string
          status: string
          to_account_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          fees?: number
          frequency: string
          from_account_id: string
          fx_rate?: number
          id?: string
          interval_count?: number
          last_run_at?: string | null
          name: string
          next_run_at: string
          organization_id?: string
          reference?: string | null
          start_date: string
          status?: string
          to_account_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          fees?: number
          frequency?: string
          from_account_id?: string
          fx_rate?: number
          id?: string
          interval_count?: number
          last_run_at?: string | null
          name?: string
          next_run_at?: string
          organization_id?: string
          reference?: string | null
          start_date?: string
          status?: string
          to_account_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_transfers_from_account_id_fkey"
            columns: ["from_account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "recurring_transfers_from_account_id_fkey"
            columns: ["from_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transfers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "recurring_transfers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transfers_to_account_id_fkey"
            columns: ["to_account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "recurring_transfers_to_account_id_fkey"
            columns: ["to_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      release_instructions: {
        Row: {
          consignee_name: string | null
          container_id: string | null
          container_number: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          driver_id_number: string | null
          driver_name: string | null
          id: string
          instruction_number: string
          notes: string | null
          organization_id: string
          release_type: string
          source: string
          status: string
          truck_plate: string | null
          updated_at: string
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          consignee_name?: string | null
          container_id?: string | null
          container_number?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          driver_id_number?: string | null
          driver_name?: string | null
          id?: string
          instruction_number: string
          notes?: string | null
          organization_id?: string
          release_type?: string
          source?: string
          status?: string
          truck_plate?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          consignee_name?: string | null
          container_id?: string | null
          container_number?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          driver_id_number?: string | null
          driver_name?: string | null
          id?: string
          instruction_number?: string
          notes?: string | null
          organization_id?: string
          release_type?: string
          source?: string
          status?: string
          truck_plate?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "release_instructions_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_instructions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_instructions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "release_instructions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_line_items: {
        Row: {
          created_at: string
          description: string
          estimate_id: string
          id: string
          organization_id: string
          part_number: string | null
          quantity: number
          total_cost: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          description: string
          estimate_id: string
          id?: string
          organization_id?: string
          part_number?: string | null
          quantity?: number
          total_cost?: number
          unit_cost?: number
        }
        Update: {
          created_at?: string
          description?: string
          estimate_id?: string
          id?: string
          organization_id?: string
          part_number?: string | null
          quantity?: number
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "repair_line_items_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "damage_estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_line_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "repair_line_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      repat_rate_cards: {
        Row: {
          container_size: string
          created_at: string
          created_by: string | null
          currency: string | null
          destination: string
          effective_from: string
          effective_to: string | null
          handling_fee: number
          id: string
          is_active: boolean
          notes: string | null
          organization_id: string
          origin: string
          rate_amount: number
          shipping_line: string | null
          transfer_fee: number
          updated_at: string
        }
        Insert: {
          container_size?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          destination: string
          effective_from?: string
          effective_to?: string | null
          handling_fee?: number
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string
          origin: string
          rate_amount?: number
          shipping_line?: string | null
          transfer_fee?: number
          updated_at?: string
        }
        Update: {
          container_size?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          destination?: string
          effective_from?: string
          effective_to?: string | null
          handling_fee?: number
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string
          origin?: string
          rate_amount?: number
          shipping_line?: string | null
          transfer_fee?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "repat_rate_cards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "repat_rate_cards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      repatriation_costs: {
        Row: {
          amount: number
          cost_type: string
          created_at: string
          description: string | null
          id: string
          organization_id: string
          repatriation_id: string
        }
        Insert: {
          amount?: number
          cost_type: string
          created_at?: string
          description?: string | null
          id?: string
          organization_id?: string
          repatriation_id: string
        }
        Update: {
          amount?: number
          cost_type?: string
          created_at?: string
          description?: string | null
          id?: string
          organization_id?: string
          repatriation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repatriation_costs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "repatriation_costs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repatriation_costs_repatriation_id_fkey"
            columns: ["repatriation_id"]
            isOneToOne: false
            referencedRelation: "repatriations"
            referencedColumns: ["id"]
          },
        ]
      }
      repatriation_handling_invoice_lines: {
        Row: {
          amount: number
          container_number: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          invoice_id: string
          organization_id: string
          repatriation_id: string
          repatriation_number: string
        }
        Insert: {
          amount?: number
          container_number: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          invoice_id: string
          organization_id?: string
          repatriation_id: string
          repatriation_number: string
        }
        Update: {
          amount?: number
          container_number?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          invoice_id?: string
          organization_id?: string
          repatriation_id?: string
          repatriation_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "repatriation_handling_invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repatriation_handling_invoice_lines_repatriation_id_fkey"
            columns: ["repatriation_id"]
            isOneToOne: true
            referencedRelation: "repatriations"
            referencedColumns: ["id"]
          },
        ]
      }
      repatriation_release_audit: {
        Row: {
          created_at: string
          event_type: string
          expected_ro: string | null
          id: string
          new_ro: string | null
          organization_id: string
          performed_by: string | null
          previous_ro: string | null
          reason: string | null
          release_instruction_id: string | null
          repatriation_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          expected_ro?: string | null
          id?: string
          new_ro?: string | null
          organization_id: string
          performed_by?: string | null
          previous_ro?: string | null
          reason?: string | null
          release_instruction_id?: string | null
          repatriation_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          expected_ro?: string | null
          id?: string
          new_ro?: string | null
          organization_id?: string
          performed_by?: string | null
          previous_ro?: string | null
          reason?: string | null
          release_instruction_id?: string | null
          repatriation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repatriation_release_audit_repatriation_id_fkey"
            columns: ["repatriation_id"]
            isOneToOne: false
            referencedRelation: "repatriations"
            referencedColumns: ["id"]
          },
        ]
      }
      repatriation_ro_mismatches: {
        Row: {
          actual_ro: string | null
          detected_at: string
          expected_ro: string | null
          id: string
          organization_id: string
          release_instruction_id: string | null
          repatriation_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          actual_ro?: string | null
          detected_at?: string
          expected_ro?: string | null
          id?: string
          organization_id: string
          release_instruction_id?: string | null
          repatriation_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          actual_ro?: string | null
          detected_at?: string
          expected_ro?: string | null
          id?: string
          organization_id?: string
          release_instruction_id?: string | null
          repatriation_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repatriation_ro_mismatches_repatriation_id_fkey"
            columns: ["repatriation_id"]
            isOneToOne: true
            referencedRelation: "repatriations"
            referencedColumns: ["id"]
          },
        ]
      }
      repatriation_transfer_invoice_lines: {
        Row: {
          amount: number
          container_number: string | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          invoice_id: string
          organization_id: string
          rate_card_id: string | null
          repatriation_id: string
          repatriation_number: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          container_number?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          invoice_id: string
          organization_id: string
          rate_card_id?: string | null
          repatriation_id: string
          repatriation_number?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          container_number?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          invoice_id?: string
          organization_id?: string
          rate_card_id?: string | null
          repatriation_id?: string
          repatriation_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "repatriation_transfer_invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repatriation_transfer_invoice_lines_repatriation_id_fkey"
            columns: ["repatriation_id"]
            isOneToOne: true
            referencedRelation: "repatriations"
            referencedColumns: ["id"]
          },
        ]
      }
      repatriations: {
        Row: {
          approval_request_id: string | null
          approval_status: Database["public"]["Enums"]["approval_doc_status"]
          approved_at: string | null
          approved_by: string | null
          carrier_cost: number
          carrier_cost_currency: string | null
          carrier_fx_rate: number | null
          carrier_id: string | null
          charge_amount: number
          completed_at: string | null
          container_id: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          destination: string
          dispatched_at: string | null
          eir_id: string | null
          execution_mode: string
          handling_amount: number | null
          handling_invoice_id: string | null
          id: string
          invoice_id: string | null
          notes: string | null
          organization_id: string
          origin: string | null
          project_id: string | null
          rate_amount_applied: number | null
          rate_applied_at: string | null
          rate_card_id: string | null
          rejection_reason: string | null
          release_instruction_id: string | null
          release_order_no: string
          repatriation_number: string
          requested_at: string
          shipping_line: string
          status: Database["public"]["Enums"]["repatriation_status"]
          transfer_fee_applied: number | null
          transfer_fee_applied_at: string | null
          transfer_fee_currency: string | null
          transfer_invoice_id: string | null
          transporter: string | null
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          approval_request_id?: string | null
          approval_status?: Database["public"]["Enums"]["approval_doc_status"]
          approved_at?: string | null
          approved_by?: string | null
          carrier_cost?: number
          carrier_cost_currency?: string | null
          carrier_fx_rate?: number | null
          carrier_id?: string | null
          charge_amount?: number
          completed_at?: string | null
          container_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          destination: string
          dispatched_at?: string | null
          eir_id?: string | null
          execution_mode?: string
          handling_amount?: number | null
          handling_invoice_id?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          organization_id?: string
          origin?: string | null
          project_id?: string | null
          rate_amount_applied?: number | null
          rate_applied_at?: string | null
          rate_card_id?: string | null
          rejection_reason?: string | null
          release_instruction_id?: string | null
          release_order_no: string
          repatriation_number: string
          requested_at?: string
          shipping_line: string
          status?: Database["public"]["Enums"]["repatriation_status"]
          transfer_fee_applied?: number | null
          transfer_fee_applied_at?: string | null
          transfer_fee_currency?: string | null
          transfer_invoice_id?: string | null
          transporter?: string | null
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          approval_request_id?: string | null
          approval_status?: Database["public"]["Enums"]["approval_doc_status"]
          approved_at?: string | null
          approved_by?: string | null
          carrier_cost?: number
          carrier_cost_currency?: string | null
          carrier_fx_rate?: number | null
          carrier_id?: string | null
          charge_amount?: number
          completed_at?: string | null
          container_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          destination?: string
          dispatched_at?: string | null
          eir_id?: string | null
          execution_mode?: string
          handling_amount?: number | null
          handling_invoice_id?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          organization_id?: string
          origin?: string | null
          project_id?: string | null
          rate_amount_applied?: number | null
          rate_applied_at?: string | null
          rate_card_id?: string | null
          rejection_reason?: string | null
          release_instruction_id?: string | null
          release_order_no?: string
          repatriation_number?: string
          requested_at?: string
          shipping_line?: string
          status?: Database["public"]["Enums"]["repatriation_status"]
          transfer_fee_applied?: number | null
          transfer_fee_applied_at?: string | null
          transfer_fee_currency?: string | null
          transfer_invoice_id?: string | null
          transporter?: string | null
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "repatriations_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repatriations_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "logistics_carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repatriations_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repatriations_eir_id_fkey"
            columns: ["eir_id"]
            isOneToOne: false
            referencedRelation: "eir_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repatriations_handling_invoice_id_fkey"
            columns: ["handling_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repatriations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repatriations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "repatriations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repatriations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "repatriations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repatriations_rate_card_id_fkey"
            columns: ["rate_card_id"]
            isOneToOne: false
            referencedRelation: "repat_rate_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repatriations_release_instruction_id_fkey"
            columns: ["release_instruction_id"]
            isOneToOne: false
            referencedRelation: "release_instructions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repatriations_transfer_invoice_id_fkey"
            columns: ["transfer_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repatriations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "logistics_trip_pnl"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "repatriations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "logistics_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      rfq_attachments: {
        Row: {
          content_type: string | null
          created_at: string
          file_name: string
          file_path: string
          id: string
          label: string | null
          organization_id: string
          rfq_id: string
          rfq_item_id: string | null
          size_bytes: number | null
          uploaded_by: string | null
        }
        Insert: {
          content_type?: string | null
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          label?: string | null
          organization_id?: string
          rfq_id: string
          rfq_item_id?: string | null
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Update: {
          content_type?: string | null
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          label?: string | null
          organization_id?: string
          rfq_id?: string
          rfq_item_id?: string | null
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rfq_attachments_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_attachments_rfq_item_id_fkey"
            columns: ["rfq_item_id"]
            isOneToOne: false
            referencedRelation: "rfq_items"
            referencedColumns: ["id"]
          },
        ]
      }
      rfq_items: {
        Row: {
          created_at: string
          description: string
          id: string
          material_id: string | null
          organization_id: string
          part_number: string | null
          quantity: number
          rfq_id: string
          sort_order: number
          specification: string | null
          uom: string | null
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          material_id?: string | null
          organization_id?: string
          part_number?: string | null
          quantity?: number
          rfq_id: string
          sort_order?: number
          specification?: string | null
          uom?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          material_id?: string | null
          organization_id?: string
          part_number?: string | null
          quantity?: number
          rfq_id?: string
          sort_order?: number
          specification?: string | null
          uom?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rfq_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "material_stock_reconciliation"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "rfq_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "rfq_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_items_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
        ]
      }
      rfq_supplier_quotes: {
        Row: {
          created_at: string
          currency: string | null
          id: string
          lead_time_days: number | null
          notes: string | null
          organization_id: string
          rfq_item_id: string
          rfq_supplier_id: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string | null
          id?: string
          lead_time_days?: number | null
          notes?: string | null
          organization_id?: string
          rfq_item_id: string
          rfq_supplier_id: string
          unit_price?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string | null
          id?: string
          lead_time_days?: number | null
          notes?: string | null
          organization_id?: string
          rfq_item_id?: string
          rfq_supplier_id?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfq_supplier_quotes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "rfq_supplier_quotes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_supplier_quotes_rfq_item_id_fkey"
            columns: ["rfq_item_id"]
            isOneToOne: false
            referencedRelation: "rfq_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_supplier_quotes_rfq_supplier_id_fkey"
            columns: ["rfq_supplier_id"]
            isOneToOne: false
            referencedRelation: "rfq_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      rfq_suppliers: {
        Row: {
          created_at: string
          decline_reason: string | null
          id: string
          invite_channel: string | null
          invited_at: string | null
          last_reminder_at: string | null
          notes: string | null
          organization_id: string
          responded_at: string | null
          rfq_id: string
          sent_at: string | null
          status: string
          supplier_id: string
          token: string
        }
        Insert: {
          created_at?: string
          decline_reason?: string | null
          id?: string
          invite_channel?: string | null
          invited_at?: string | null
          last_reminder_at?: string | null
          notes?: string | null
          organization_id?: string
          responded_at?: string | null
          rfq_id: string
          sent_at?: string | null
          status?: string
          supplier_id: string
          token?: string
        }
        Update: {
          created_at?: string
          decline_reason?: string | null
          id?: string
          invite_channel?: string | null
          invited_at?: string | null
          last_reminder_at?: string | null
          notes?: string | null
          organization_id?: string
          responded_at?: string | null
          rfq_id?: string
          sent_at?: string | null
          status?: string
          supplier_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfq_suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "rfq_suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_suppliers_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_suppliers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      rfqs: {
        Row: {
          awarded_po_id: string | null
          awarded_supplier_id: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          id: string
          notes: string | null
          organization_id: string
          response_deadline: string | null
          rfq_number: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          awarded_po_id?: string | null
          awarded_supplier_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          response_deadline?: string | null
          rfq_number: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          awarded_po_id?: string | null
          awarded_supplier_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          response_deadline?: string | null
          rfq_number?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfqs_awarded_po_id_fkey"
            columns: ["awarded_po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_awarded_po_id_fkey"
            columns: ["awarded_po_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_vat_summary"
            referencedColumns: ["purchase_order_id"]
          },
          {
            foreignKeyName: "rfqs_awarded_supplier_id_fkey"
            columns: ["awarded_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "rfqs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permission_defaults: {
        Row: {
          action: Database["public"]["Enums"]["app_action"]
          allowed: boolean
          created_at: string
          id: string
          module: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          action: Database["public"]["Enums"]["app_action"]
          allowed?: boolean
          created_at?: string
          id?: string
          module: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          action?: Database["public"]["Enums"]["app_action"]
          allowed?: boolean
          created_at?: string
          id?: string
          module?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      role_permission_overrides: {
        Row: {
          action: Database["public"]["Enums"]["app_action"]
          allowed: boolean
          id: string
          module: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["app_action"]
          allowed: boolean
          id?: string
          module: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["app_action"]
          allowed?: boolean
          id?: string
          module?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      sales_order_items: {
        Row: {
          container_id: string | null
          conversion_id: string | null
          created_at: string
          description: string
          id: string
          item_type: string
          organization_id: string
          quantity: number
          sales_order_id: string
          total_price: number
          unit_price: number
        }
        Insert: {
          container_id?: string | null
          conversion_id?: string | null
          created_at?: string
          description: string
          id?: string
          item_type?: string
          organization_id?: string
          quantity?: number
          sales_order_id: string
          total_price?: number
          unit_price?: number
        }
        Update: {
          container_id?: string | null
          conversion_id?: string | null
          created_at?: string
          description?: string
          id?: string
          item_type?: string
          organization_id?: string
          quantity?: number
          sales_order_id?: string
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_items_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_items_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_items_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "sales_order_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sales_order_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_items_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_orders: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          notes: string | null
          order_number: string
          organization_id: string
          project_id: string | null
          quote_id: string | null
          status: string
          total_amount: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          notes?: string | null
          order_number: string
          organization_id?: string
          project_id?: string | null
          quote_id?: string | null
          status?: string
          total_amount?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          notes?: string | null
          order_number?: string
          organization_id?: string
          project_id?: string | null
          quote_id?: string | null
          status?: string
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sales_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "sales_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      security_findings: {
        Row: {
          affected_object: string | null
          category: string
          created_at: string
          description: string | null
          detected_at: string
          external_id: string | null
          fixed_at: string | null
          fixed_by: string | null
          id: string
          organization_id: string | null
          reference_url: string | null
          remediation_notes: string | null
          remediation_sql: string | null
          severity: string
          source: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          affected_object?: string | null
          category?: string
          created_at?: string
          description?: string | null
          detected_at?: string
          external_id?: string | null
          fixed_at?: string | null
          fixed_by?: string | null
          id?: string
          organization_id?: string | null
          reference_url?: string | null
          remediation_notes?: string | null
          remediation_sql?: string | null
          severity?: string
          source?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          affected_object?: string | null
          category?: string
          created_at?: string
          description?: string | null
          detected_at?: string
          external_id?: string | null
          fixed_at?: string | null
          fixed_by?: string | null
          id?: string
          organization_id?: string | null
          reference_url?: string | null
          remediation_notes?: string | null
          remediation_sql?: string | null
          severity?: string
          source?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      staff_invitations: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          display_name: string | null
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          roles: Database["public"]["Enums"]["app_role"][] | null
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          revoked_at?: string | null
          role: Database["public"]["Enums"]["app_role"]
          roles?: Database["public"]["Enums"]["app_role"][] | null
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          roles?: Database["public"]["Enums"]["app_role"][] | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "staff_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          adjusted_by: string | null
          adjustment_type: Database["public"]["Enums"]["stock_adjustment_type"]
          created_at: string
          currency: string | null
          from_depot_id: string | null
          gl_journal_id: string | null
          id: string
          item_id: string
          item_label: string | null
          item_type: Database["public"]["Enums"]["stock_adjustment_item_type"]
          organization_id: string
          qty_after: number
          qty_before: number
          qty_delta: number
          reason_category: Database["public"]["Enums"]["stock_adjustment_reason"]
          reason_text: string
          reference: string
          to_depot_id: string | null
          unit_cost: number
          value_delta: number
        }
        Insert: {
          adjusted_by?: string | null
          adjustment_type: Database["public"]["Enums"]["stock_adjustment_type"]
          created_at?: string
          currency?: string | null
          from_depot_id?: string | null
          gl_journal_id?: string | null
          id?: string
          item_id: string
          item_label?: string | null
          item_type: Database["public"]["Enums"]["stock_adjustment_item_type"]
          organization_id?: string
          qty_after: number
          qty_before: number
          qty_delta: number
          reason_category: Database["public"]["Enums"]["stock_adjustment_reason"]
          reason_text: string
          reference: string
          to_depot_id?: string | null
          unit_cost?: number
          value_delta?: number
        }
        Update: {
          adjusted_by?: string | null
          adjustment_type?: Database["public"]["Enums"]["stock_adjustment_type"]
          created_at?: string
          currency?: string | null
          from_depot_id?: string | null
          gl_journal_id?: string | null
          id?: string
          item_id?: string
          item_label?: string | null
          item_type?: Database["public"]["Enums"]["stock_adjustment_item_type"]
          organization_id?: string
          qty_after?: number
          qty_before?: number
          qty_delta?: number
          reason_category?: Database["public"]["Enums"]["stock_adjustment_reason"]
          reason_text?: string
          reference?: string
          to_depot_id?: string | null
          unit_cost?: number
          value_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_from_depot_id_fkey"
            columns: ["from_depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "stock_adjustments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_to_depot_id_fkey"
            columns: ["to_depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
        ]
      }
      store_issues: {
        Row: {
          conversion_id: string
          created_at: string
          id: string
          issue_number: string
          issued_by: string | null
          material_id: string
          notes: string | null
          organization_id: string
          quantity: number
        }
        Insert: {
          conversion_id: string
          created_at?: string
          id?: string
          issue_number: string
          issued_by?: string | null
          material_id: string
          notes?: string | null
          organization_id?: string
          quantity?: number
        }
        Update: {
          conversion_id?: string
          created_at?: string
          id?: string
          issue_number?: string
          issued_by?: string | null
          material_id?: string
          notes?: string | null
          organization_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "store_issues_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_issues_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "store_issues_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "material_stock_reconciliation"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "store_issues_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_issues_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "store_issues_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      store_returns: {
        Row: {
          conversion_id: string | null
          created_at: string
          id: string
          material_id: string
          organization_id: string
          quantity: number
          reason: string | null
          return_number: string
          returned_by: string | null
        }
        Insert: {
          conversion_id?: string | null
          created_at?: string
          id?: string
          material_id: string
          organization_id?: string
          quantity?: number
          reason?: string | null
          return_number: string
          returned_by?: string | null
        }
        Update: {
          conversion_id?: string | null
          created_at?: string
          id?: string
          material_id?: string
          organization_id?: string
          quantity?: number
          reason?: string | null
          return_number?: string
          returned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_returns_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_returns_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "store_returns_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "material_stock_reconciliation"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "store_returns_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_returns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "store_returns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_assembly_bom_labor: {
        Row: {
          assembly_stock_id: string
          created_at: string
          employee_id: string | null
          hours_per_unit: number
          id: string
          notes: string | null
          organization_id: string
          rate_per_hour: number
          role: string
          updated_at: string
        }
        Insert: {
          assembly_stock_id: string
          created_at?: string
          employee_id?: string | null
          hours_per_unit?: number
          id?: string
          notes?: string | null
          organization_id?: string
          rate_per_hour?: number
          role: string
          updated_at?: string
        }
        Update: {
          assembly_stock_id?: string
          created_at?: string
          employee_id?: string | null
          hours_per_unit?: number
          id?: string
          notes?: string | null
          organization_id?: string
          rate_per_hour?: number
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sub_assembly_bom_labor_assembly_stock_id_fkey"
            columns: ["assembly_stock_id"]
            isOneToOne: false
            referencedRelation: "sub_assembly_stock"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_assembly_bom_labor_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "sub_assembly_bom_labor_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_payroll_status"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "sub_assembly_bom_labor_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_assembly_bom_labor_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sub_assembly_bom_labor_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_assembly_bom_materials: {
        Row: {
          assembly_stock_id: string
          created_at: string
          id: string
          material_id: string
          notes: string | null
          organization_id: string
          qty_per_unit: number
          updated_at: string
        }
        Insert: {
          assembly_stock_id: string
          created_at?: string
          id?: string
          material_id: string
          notes?: string | null
          organization_id?: string
          qty_per_unit?: number
          updated_at?: string
        }
        Update: {
          assembly_stock_id?: string
          created_at?: string
          id?: string
          material_id?: string
          notes?: string | null
          organization_id?: string
          qty_per_unit?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sub_assembly_bom_materials_assembly_stock_id_fkey"
            columns: ["assembly_stock_id"]
            isOneToOne: false
            referencedRelation: "sub_assembly_stock"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_assembly_bom_materials_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "material_stock_reconciliation"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "sub_assembly_bom_materials_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_assembly_bom_materials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sub_assembly_bom_materials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_assembly_bom_overheads: {
        Row: {
          assembly_stock_id: string
          cost_per_unit: number
          created_at: string
          description: string
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          assembly_stock_id: string
          cost_per_unit?: number
          created_at?: string
          description: string
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Update: {
          assembly_stock_id?: string
          cost_per_unit?: number
          created_at?: string
          description?: string
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sub_assembly_bom_overheads_assembly_stock_id_fkey"
            columns: ["assembly_stock_id"]
            isOneToOne: false
            referencedRelation: "sub_assembly_stock"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_assembly_bom_overheads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sub_assembly_bom_overheads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_assembly_lots: {
        Row: {
          assembly_stock_id: string
          conversion_id: string | null
          created_at: string
          id: string
          organization_id: string
          project_id: string | null
          qty: number
          unit_cost: number
        }
        Insert: {
          assembly_stock_id: string
          conversion_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          project_id?: string | null
          qty: number
          unit_cost?: number
        }
        Update: {
          assembly_stock_id?: string
          conversion_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          project_id?: string | null
          qty?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "sub_assembly_lots_assembly_stock_id_fkey"
            columns: ["assembly_stock_id"]
            isOneToOne: false
            referencedRelation: "sub_assembly_stock"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_assembly_lots_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_assembly_lots_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "sub_assembly_lots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "sub_assembly_lots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_assembly_movements: {
        Row: {
          assembly_stock_id: string
          conversion_id: string | null
          created_at: string
          created_by: string | null
          id: string
          movement_type: string
          organization_id: string | null
          project_id: string | null
          qty: number
          reason: string | null
          unit_cost: number
        }
        Insert: {
          assembly_stock_id: string
          conversion_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          movement_type: string
          organization_id?: string | null
          project_id?: string | null
          qty: number
          reason?: string | null
          unit_cost?: number
        }
        Update: {
          assembly_stock_id?: string
          conversion_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          movement_type?: string
          organization_id?: string | null
          project_id?: string | null
          qty?: number
          reason?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "sub_assembly_movements_assembly_stock_id_fkey"
            columns: ["assembly_stock_id"]
            isOneToOne: false
            referencedRelation: "sub_assembly_stock"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_assembly_movements_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_assembly_movements_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "sub_assembly_movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "sub_assembly_movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_assembly_sales: {
        Row: {
          assembly_stock_id: string
          buyer_customer_id: string | null
          buyer_name: string
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string | null
          notes: string | null
          organization_id: string
          qty: number
          sold_at: string
          total_price: number
          unit_cost_snapshot: number
          unit_price: number
        }
        Insert: {
          assembly_stock_id: string
          buyer_customer_id?: string | null
          buyer_name: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          organization_id?: string
          qty: number
          sold_at?: string
          total_price?: number
          unit_cost_snapshot?: number
          unit_price?: number
        }
        Update: {
          assembly_stock_id?: string
          buyer_customer_id?: string | null
          buyer_name?: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          organization_id?: string
          qty?: number
          sold_at?: string
          total_price?: number
          unit_cost_snapshot?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sub_assembly_sales_assembly_stock_id_fkey"
            columns: ["assembly_stock_id"]
            isOneToOne: false
            referencedRelation: "sub_assembly_stock"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_assembly_sales_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_assembly_sales_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sub_assembly_sales_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_assembly_stock: {
        Row: {
          assembly_type: Database["public"]["Enums"]["assembly_type"]
          avg_unit_cost: number
          bom_unit_cost: number
          created_at: string
          default_sale_price: number | null
          id: string
          name: string
          notes: string | null
          on_hand_qty: number
          organization_id: string
          project_id: string | null
          reorder_point: number
          uom: string
          updated_at: string
        }
        Insert: {
          assembly_type: Database["public"]["Enums"]["assembly_type"]
          avg_unit_cost?: number
          bom_unit_cost?: number
          created_at?: string
          default_sale_price?: number | null
          id?: string
          name: string
          notes?: string | null
          on_hand_qty?: number
          organization_id?: string
          project_id?: string | null
          reorder_point?: number
          uom?: string
          updated_at?: string
        }
        Update: {
          assembly_type?: Database["public"]["Enums"]["assembly_type"]
          avg_unit_cost?: number
          bom_unit_cost?: number
          created_at?: string
          default_sale_price?: number | null
          id?: string
          name?: string
          notes?: string | null
          on_hand_qty?: number
          organization_id?: string
          project_id?: string | null
          reorder_point?: number
          uom?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sub_assembly_stock_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "sub_assembly_stock_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_modules: {
        Row: {
          enabled: boolean
          enabled_at: string
          id: string
          module_code: string
          organization_id: string
          price_snapshot: number
        }
        Insert: {
          enabled?: boolean
          enabled_at?: string
          id?: string
          module_code: string
          organization_id: string
          price_snapshot?: number
        }
        Update: {
          enabled?: boolean
          enabled_at?: string
          id?: string
          module_code?: string
          organization_id?: string
          price_snapshot?: number
        }
        Relationships: [
          {
            foreignKeyName: "subscription_modules_module_code_fkey"
            columns: ["module_code"]
            isOneToOne: false
            referencedRelation: "modules_catalog"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "subscription_modules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "subscription_modules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          base_fee: number
          billing_cycle: Database["public"]["Enums"]["billing_cycle"]
          billing_email: string | null
          cancel_at_period_end: boolean
          created_at: string
          currency: string
          current_period_end: string
          current_period_start: string
          id: string
          last_invoiced_period_end: string | null
          next_invoice_at: string | null
          notes: string | null
          organization_id: string
          per_seat_fee: number
          seat_limit: number | null
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          base_fee?: number
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"]
          billing_email?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          currency?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          last_invoiced_period_end?: string | null
          next_invoice_at?: string | null
          notes?: string | null
          organization_id: string
          per_seat_fee?: number
          seat_limit?: number | null
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          base_fee?: number
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"]
          billing_email?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          currency?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          last_invoiced_period_end?: string | null
          next_invoice_at?: string | null
          notes?: string | null
          organization_id?: string
          per_seat_fee?: number
          seat_limit?: number | null
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_invoice_audit: {
        Row: {
          action: string
          actor_id: string | null
          changes: Json
          created_at: string
          id: string
          invoice_id: string
          organization_id: string
          reason: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          changes?: Json
          created_at?: string
          id?: string
          invoice_id: string
          organization_id: string
          reason: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          changes?: Json
          created_at?: string
          id?: string
          invoice_id?: string
          organization_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_invoice_audit_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_invoice_lines: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          line_total: number
          organization_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          line_total?: number
          organization_id: string
          quantity?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          line_total?: number
          organization_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplier_invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_invoices: {
        Row: {
          acquisition_component: string | null
          base_amount: number | null
          container_id: string | null
          created_at: string
          currency: string
          due_date: string
          fx_rate: number | null
          fx_rate_source: string
          id: string
          invoice_kind: string
          invoice_number: string
          issue_date: string
          notes: string | null
          organization_id: string
          paid_amount: number
          pricing_basis: string | null
          pricing_note: string | null
          purchase_order_id: string | null
          reason: string
          reference: string | null
          status: string
          subtotal: number
          supplier_id: string
          supplier_ref: string | null
          tax_amount: number
          total_amount: number
          updated_at: string
        }
        Insert: {
          acquisition_component?: string | null
          base_amount?: number | null
          container_id?: string | null
          created_at?: string
          currency: string
          due_date?: string
          fx_rate?: number | null
          fx_rate_source?: string
          id?: string
          invoice_kind?: string
          invoice_number: string
          issue_date?: string
          notes?: string | null
          organization_id: string
          paid_amount?: number
          pricing_basis?: string | null
          pricing_note?: string | null
          purchase_order_id?: string | null
          reason?: string
          reference?: string | null
          status?: string
          subtotal?: number
          supplier_id: string
          supplier_ref?: string | null
          tax_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Update: {
          acquisition_component?: string | null
          base_amount?: number | null
          container_id?: string | null
          created_at?: string
          currency?: string
          due_date?: string
          fx_rate?: number | null
          fx_rate_source?: string
          id?: string
          invoice_kind?: string
          invoice_number?: string
          issue_date?: string
          notes?: string | null
          organization_id?: string
          paid_amount?: number
          pricing_basis?: string | null
          pricing_note?: string | null
          purchase_order_id?: string | null
          reason?: string
          reference?: string | null
          status?: string
          subtotal?: number
          supplier_id?: string
          supplier_ref?: string | null
          tax_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_invoices_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoices_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoices_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_vat_summary"
            referencedColumns: ["purchase_order_id"]
          },
          {
            foreignKeyName: "supplier_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          currency: string
          email: string | null
          id: string
          is_active: boolean
          linked_customer_id: string | null
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          currency: string
          email?: string | null
          id?: string
          is_active?: boolean
          linked_customer_id?: string | null
          name: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          currency?: string
          email?: string | null
          id?: string
          is_active?: boolean
          linked_customer_id?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_linked_customer_id_fkey"
            columns: ["linked_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      sync_audit_findings: {
        Row: {
          created_at: string
          details: Json
          finding_code: string
          id: string
          organization_id: string
          reference_id: string | null
          reference_type: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
        }
        Insert: {
          created_at?: string
          details?: Json
          finding_code: string
          id?: string
          organization_id: string
          reference_id?: string | null
          reference_type?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
        }
        Update: {
          created_at?: string
          details?: Json
          finding_code?: string
          id?: string
          organization_id?: string
          reference_id?: string | null
          reference_type?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
        }
        Relationships: []
      }
      tariffs: {
        Row: {
          container_category: string
          container_size: string
          created_at: string
          currency: string | null
          free_days: number
          gate_in_fee: number
          handling_fee: number
          height_class:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id: string
          is_active: boolean
          organization_id: string
          rate_per_day: number
          tariff_name: string
          updated_at: string
        }
        Insert: {
          container_category?: string
          container_size?: string
          created_at?: string
          currency?: string | null
          free_days?: number
          gate_in_fee?: number
          handling_fee?: number
          height_class?:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id?: string
          is_active?: boolean
          organization_id?: string
          rate_per_day?: number
          tariff_name: string
          updated_at?: string
        }
        Update: {
          container_category?: string
          container_size?: string
          created_at?: string
          currency?: string | null
          free_days?: number
          gate_in_fee?: number
          handling_fee?: number
          height_class?:
            | Database["public"]["Enums"]["container_height_class"]
            | null
          id?: string
          is_active?: boolean
          organization_id?: string
          rate_per_day?: number
          tariff_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tariffs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "tariffs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_codes: {
        Row: {
          code: string
          created_at: string
          gl_account_id: string | null
          id: string
          is_active: boolean
          jurisdiction: string
          kind: string
          name: string
          organization_id: string
          rate: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          gl_account_id?: string | null
          id?: string
          is_active?: boolean
          jurisdiction?: string
          kind: string
          name: string
          organization_id?: string
          rate?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          gl_account_id?: string | null
          id?: string
          is_active?: boolean
          jurisdiction?: string
          kind?: string
          name?: string
          organization_id?: string
          rate?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_codes_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_codes_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["gl_account_id"]
          },
        ]
      }
      tax_returns: {
        Row: {
          created_at: string
          filed_at: string | null
          id: string
          input_total: number
          journal_id: string | null
          jurisdiction: string
          net_payable: number
          organization_id: string
          output_total: number
          period_id: string
          reference: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          filed_at?: string | null
          id?: string
          input_total?: number
          journal_id?: string | null
          jurisdiction?: string
          net_payable?: number
          organization_id?: string
          output_total?: number
          period_id: string
          reference?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          filed_at?: string | null
          id?: string
          input_total?: number
          journal_id?: string | null
          jurisdiction?: string
          net_payable?: number
          organization_id?: string
          output_total?: number
          period_id?: string
          reference?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_returns_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "fiscal_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      trucks_drivers: {
        Row: {
          company: string | null
          created_at: string
          driver_license: string | null
          driver_name: string
          driver_phone: string | null
          id: string
          is_active: boolean
          notes: string | null
          organization_id: string
          truck_plate: string
          updated_at: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          driver_license?: string | null
          driver_name: string
          driver_phone?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string
          truck_plate: string
          updated_at?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          driver_license?: string | null
          driver_name?: string
          driver_phone?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string
          truck_plate?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trucks_drivers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "trucks_drivers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permission_overrides: {
        Row: {
          action: Database["public"]["Enums"]["app_action"]
          allowed: boolean
          created_at: string
          id: string
          module: string
          organization_id: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["app_action"]
          allowed?: boolean
          created_at?: string
          id?: string
          module: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["app_action"]
          allowed?: boolean
          created_at?: string
          id?: string
          module?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permission_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "user_permission_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          organization_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_payment_allocations: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          fx_rate: number | null
          id: string
          method: string
          note: string | null
          organization_id: string
          payment_id: string
          rule_applied: string | null
          supplier_invoice_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          fx_rate?: number | null
          id?: string
          method?: string
          note?: string | null
          organization_id: string
          payment_id: string
          rule_applied?: string | null
          supplier_invoice_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          fx_rate?: number | null
          id?: string
          method?: string
          note?: string | null
          organization_id?: string
          payment_id?: string
          rule_applied?: string | null
          supplier_invoice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_unallocated_vendor_payments"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "vendor_payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "vendor_payment_unallocated"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "vendor_payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "vendor_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payment_allocations_supplier_invoice_id_fkey"
            columns: ["supplier_invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_payments: {
        Row: {
          amount: number
          approval_request_id: string | null
          approval_status: Database["public"]["Enums"]["approval_doc_status"]
          approved_at: string | null
          approved_by: string | null
          bank_charge_amount: number
          bank_charge_expense_id: string | null
          base_amount: number | null
          conversion_id: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          financial_account_id: string | null
          fx_rate: number | null
          id: string
          notes: string | null
          organization_id: string
          paid_at: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_number: string
          po_id: string | null
          project_id: string | null
          recorded_by: string | null
          reference_number: string | null
          rejection_reason: string | null
          supplier_id: string
        }
        Insert: {
          amount: number
          approval_request_id?: string | null
          approval_status?: Database["public"]["Enums"]["approval_doc_status"]
          approved_at?: string | null
          approved_by?: string | null
          bank_charge_amount?: number
          bank_charge_expense_id?: string | null
          base_amount?: number | null
          conversion_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          financial_account_id?: string | null
          fx_rate?: number | null
          id?: string
          notes?: string | null
          organization_id?: string
          paid_at?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_number: string
          po_id?: string | null
          project_id?: string | null
          recorded_by?: string | null
          reference_number?: string | null
          rejection_reason?: string | null
          supplier_id: string
        }
        Update: {
          amount?: number
          approval_request_id?: string | null
          approval_status?: Database["public"]["Enums"]["approval_doc_status"]
          approved_at?: string | null
          approved_by?: string | null
          bank_charge_amount?: number
          bank_charge_expense_id?: string | null
          base_amount?: number | null
          conversion_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          financial_account_id?: string | null
          fx_rate?: number | null
          id?: string
          notes?: string | null
          organization_id?: string
          paid_at?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_number?: string
          po_id?: string | null
          project_id?: string | null
          recorded_by?: string | null
          reference_number?: string | null
          rejection_reason?: string | null
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_payments_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "container_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversion_variance_summary"
            referencedColumns: ["conversion_id"]
          },
          {
            foreignKeyName: "vendor_payments_financial_account_id_fkey"
            columns: ["financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "vendor_payments_financial_account_id_fkey"
            columns: ["financial_account_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "vendor_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_vat_summary"
            referencedColumns: ["purchase_order_id"]
          },
          {
            foreignKeyName: "vendor_payments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "vendor_payments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          created_at: string
          customer_id: string | null
          direction: string
          id: string
          linked_instruction_id: string | null
          message_body: string | null
          message_type: string
          organization_id: string
          parsed_intent: string | null
          phone_number: string
          processed: boolean
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          direction?: string
          id?: string
          linked_instruction_id?: string | null
          message_body?: string | null
          message_type?: string
          organization_id?: string
          parsed_intent?: string | null
          phone_number: string
          processed?: boolean
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          direction?: string
          id?: string
          linked_instruction_id?: string | null
          message_body?: string | null
          message_type?: string
          organization_id?: string
          parsed_intent?: string | null
          phone_number?: string
          processed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_linked_instruction_id_fkey"
            columns: ["linked_instruction_id"]
            isOneToOne: false
            referencedRelation: "release_instructions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      withholding_certificates: {
        Row: {
          amount_withheld: number
          base_amount: number
          certificate_date: string
          certificate_number: string
          created_at: string
          id: string
          notes: string | null
          organization_id: string
          rate: number
          status: string
          supplier_id: string | null
          updated_at: string
          vendor_payment_id: string | null
        }
        Insert: {
          amount_withheld?: number
          base_amount?: number
          certificate_date?: string
          certificate_number: string
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          rate?: number
          status?: string
          supplier_id?: string | null
          updated_at?: string
          vendor_payment_id?: string | null
        }
        Update: {
          amount_withheld?: number
          base_amount?: number
          certificate_date?: string
          certificate_number?: string
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          rate?: number
          status?: string
          supplier_id?: string | null
          updated_at?: string
          vendor_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "withholding_certificates_vendor_payment_id_fkey"
            columns: ["vendor_payment_id"]
            isOneToOne: false
            referencedRelation: "v_unallocated_vendor_payments"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "withholding_certificates_vendor_payment_id_fkey"
            columns: ["vendor_payment_id"]
            isOneToOne: false
            referencedRelation: "vendor_payment_unallocated"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "withholding_certificates_vendor_payment_id_fkey"
            columns: ["vendor_payment_id"]
            isOneToOne: false
            referencedRelation: "vendor_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      work_orders: {
        Row: {
          actual_cost: number | null
          asset_id: string | null
          assigned_to: string | null
          completed_at: string | null
          completion_notes: string | null
          container_id: string | null
          created_at: string
          created_by: string | null
          estimate_id: string | null
          id: string
          organization_id: string
          priority: Database["public"]["Enums"]["wo_priority"]
          started_at: string | null
          status: Database["public"]["Enums"]["wo_status"]
          updated_at: string
          wo_number: string
        }
        Insert: {
          actual_cost?: number | null
          asset_id?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          completion_notes?: string | null
          container_id?: string | null
          created_at?: string
          created_by?: string | null
          estimate_id?: string | null
          id?: string
          organization_id?: string
          priority?: Database["public"]["Enums"]["wo_priority"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["wo_status"]
          updated_at?: string
          wo_number: string
        }
        Update: {
          actual_cost?: number | null
          asset_id?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          completion_notes?: string | null
          container_id?: string | null
          created_at?: string
          created_by?: string | null
          estimate_id?: string | null
          id?: string
          organization_id?: string
          priority?: Database["public"]["Enums"]["wo_priority"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["wo_status"]
          updated_at?: string
          wo_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "damage_estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "work_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      yard_blocks: {
        Row: {
          block_type: Database["public"]["Enums"]["block_type"]
          coordinates: Json | null
          created_at: string
          depot_id: string
          has_power: boolean
          hazardous_zone: boolean
          id: string
          max_bays: number
          max_rows: number
          max_tiers: number
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          block_type?: Database["public"]["Enums"]["block_type"]
          coordinates?: Json | null
          created_at?: string
          depot_id: string
          has_power?: boolean
          hazardous_zone?: boolean
          id?: string
          max_bays?: number
          max_rows?: number
          max_tiers?: number
          name: string
          organization_id?: string
          updated_at?: string
        }
        Update: {
          block_type?: Database["public"]["Enums"]["block_type"]
          coordinates?: Json | null
          created_at?: string
          depot_id?: string
          has_power?: boolean
          hazardous_zone?: boolean
          id?: string
          max_bays?: number
          max_rows?: number
          max_tiers?: number
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "yard_blocks_depot_id_fkey"
            columns: ["depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yard_blocks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "yard_blocks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      year_end_closes: {
        Row: {
          closed_at: string
          closed_by: string | null
          fiscal_year: number
          id: string
          journal_id: string | null
          net_income: number
          notes: string | null
          organization_id: string
          retained_earnings_account: string | null
        }
        Insert: {
          closed_at?: string
          closed_by?: string | null
          fiscal_year: number
          id?: string
          journal_id?: string | null
          net_income?: number
          notes?: string | null
          organization_id?: string
          retained_earnings_account?: string | null
        }
        Update: {
          closed_at?: string
          closed_by?: string | null
          fiscal_year?: number
          id?: string
          journal_id?: string | null
          net_income?: number
          notes?: string | null
          organization_id?: string
          retained_earnings_account?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "year_end_closes_retained_earnings_account_fkey"
            columns: ["retained_earnings_account"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "year_end_closes_retained_earnings_account_fkey"
            columns: ["retained_earnings_account"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["gl_account_id"]
          },
        ]
      }
    }
    Views: {
      conversion_variance_summary: {
        Row: {
          actual_cost: number | null
          actual_qty: number | null
          conversion_id: string | null
          conversion_number: string | null
          job_kind: Database["public"]["Enums"]["conversion_job_kind"] | null
          organization_id: string | null
          planned_cost: number | null
          planned_qty: number | null
          status: Database["public"]["Enums"]["conversion_status"] | null
          variance_cost: number | null
        }
        Relationships: [
          {
            foreignKeyName: "container_conversions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "container_conversions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      currency_integrity_exceptions: {
        Row: {
          base_currency: string | null
          credit_amount: number | null
          currency: string | null
          debit_amount: number | null
          description: string | null
          fx_rate: number | null
          issue: string | null
          organization_id: string | null
          reference_id: string | null
          reference_type: string | null
          transaction_date: string | null
          transaction_id: string | null
          transaction_number: string | null
        }
        Insert: {
          base_currency?: string | null
          credit_amount?: number | null
          currency?: string | null
          debit_amount?: number | null
          description?: string | null
          fx_rate?: number | null
          issue?: never
          organization_id?: string | null
          reference_id?: string | null
          reference_type?: string | null
          transaction_date?: string | null
          transaction_id?: string | null
          transaction_number?: string | null
        }
        Update: {
          base_currency?: string | null
          credit_amount?: number | null
          currency?: string | null
          debit_amount?: number | null
          description?: string | null
          fx_rate?: number | null
          issue?: never
          organization_id?: string | null
          reference_id?: string | null
          reference_type?: string | null
          transaction_date?: string | null
          transaction_id?: string | null
          transaction_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "accounting_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_balances: {
        Row: {
          balance: number | null
          employee_id: string | null
          organization_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_payroll_status: {
        Row: {
          draft_count: number | null
          employee_id: string | null
          last_paid_at: string | null
          organization_id: string | null
          paid_amount: number | null
          paid_count: number | null
          pending_amount: number | null
          posted_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_dashboard_metrics: {
        Row: {
          base_currency: string | null
          cash_on_hand: Json | null
          cash_total: number | null
          mtd_cogs: number | null
          mtd_expense: number | null
          mtd_input_vat: number | null
          mtd_net: number | null
          mtd_revenue: number | null
          organization_id: string | null
          receivables: Json | null
          receivables_total: number | null
          recon_completed: number | null
          recon_in_progress: number | null
          recon_recent: number | null
        }
        Relationships: []
      }
      financial_account_balances: {
        Row: {
          account_id: string | null
          account_type:
            | Database["public"]["Enums"]["financial_account_type"]
            | null
          cleared_balance: number | null
          currency: string | null
          current_balance: number | null
          is_active: boolean | null
          name: string | null
          net_movement: number | null
          opening_balance: number | null
          organization_id: string | null
        }
        Insert: {
          account_id?: string | null
          account_type?:
            | Database["public"]["Enums"]["financial_account_type"]
            | null
          cleared_balance?: never
          currency?: string | null
          current_balance?: never
          is_active?: boolean | null
          name?: string | null
          net_movement?: never
          opening_balance?: number | null
          organization_id?: string | null
        }
        Update: {
          account_id?: string | null
          account_type?:
            | Database["public"]["Enums"]["financial_account_type"]
            | null
          cleared_balance?: never
          currency?: string | null
          current_balance?: never
          is_active?: boolean | null
          name?: string | null
          net_movement?: never
          opening_balance?: number | null
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "financial_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_trip_pnl: {
        Row: {
          carrier_id: string | null
          currency: string | null
          gross_margin: number | null
          margin_pct: number | null
          organization_id: string | null
          ref: string | null
          revenue: number | null
          route_id: string | null
          total_cost: number | null
          trip_date: string | null
          trip_id: string | null
          vehicle_id: string | null
        }
        Insert: {
          carrier_id?: string | null
          currency?: never
          gross_margin?: never
          margin_pct?: never
          organization_id?: string | null
          ref?: string | null
          revenue?: never
          route_id?: string | null
          total_cost?: never
          trip_date?: string | null
          trip_id?: string | null
          vehicle_id?: string | null
        }
        Update: {
          carrier_id?: string | null
          currency?: never
          gross_margin?: never
          margin_pct?: never
          organization_id?: string | null
          ref?: string | null
          revenue?: never
          route_id?: string | null
          total_cost?: never
          trip_date?: string | null
          trip_id?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logistics_trips_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "logistics_carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_trips_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "logistics_trips_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_trips_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "logistics_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_trips_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "logistics_vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      material_stock_reconciliation: {
        Row: {
          adjustments: number | null
          category: string | null
          issues: number | null
          last_movement_at: string | null
          material_id: string | null
          movement_balance: number | null
          movement_count: number | null
          name: string | null
          on_hand_qty: number | null
          organization_id: string | null
          receipts: number | null
          stock_value: number | null
          unit: string | null
          unit_cost: number | null
          variance: number | null
        }
        Relationships: [
          {
            foreignKeyName: "materials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "materials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_job_costs: {
        Row: {
          container_cost: number | null
          job_cost_total: number | null
          labour_cost: number | null
          material_cost: number | null
          organization_id: string | null
          project_id: string | null
          service_cost: number | null
        }
        Relationships: [
          {
            foreignKeyName: "container_conversions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "container_conversions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "container_conversions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "container_conversions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_pnl: {
        Row: {
          budget_amount: number | null
          code: string | null
          cogs: number | null
          currency: string | null
          expenses: number | null
          margin: number | null
          name: string | null
          organization_id: string | null
          project_id: string | null
          revenue: number | null
          status: Database["public"]["Enums"]["project_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_statement: {
        Row: {
          credit: number | null
          currency: string | null
          debit: number | null
          entry_date: string | null
          entry_id: string | null
          entry_type: string | null
          organization_id: string | null
          paid_amount: number | null
          reference: string | null
          status: string | null
          supplier_id: string | null
        }
        Relationships: []
      }
      unified_ledger_entries: {
        Row: {
          cleared_at: string | null
          credit: number | null
          currency: string | null
          debit: number | null
          description: string | null
          entry_date: string | null
          entry_id: string | null
          financial_account_id: string | null
          organization_id: string | null
          project_id: string | null
          reference_number: string | null
          source_id: string | null
          source_type: string | null
        }
        Relationships: []
      }
      v_account_balances: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"] | null
          balance: number | null
          code: string | null
          currency: string | null
          gl_account_id: string | null
          name: string | null
          organization_id: string | null
          total_credit: number | null
          total_debit: number | null
        }
        Relationships: []
      }
      v_expense_journal_lines: {
        Row: {
          account_code: string | null
          account_name: string | null
          account_type: Database["public"]["Enums"]["account_type"] | null
          approval_status: string | null
          credit_amount: number | null
          currency: string | null
          debit_amount: number | null
          depot_id: string | null
          description: string | null
          expense_number: string | null
          gl_account_id: string | null
          id: string | null
          journal_id: string | null
          organization_id: string | null
          payee: string | null
          project_id: string | null
          reference_id: string | null
          reference_type: string | null
          supplier_name: string | null
          transaction_date: string | null
          transaction_number: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_transactions_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_transactions_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["gl_account_id"]
          },
          {
            foreignKeyName: "accounting_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "accounting_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_pnl"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "accounting_transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      v_finance_data_health: {
        Row: {
          count: number | null
          detail: string | null
          finding_code: string | null
          organization_id: string | null
          severity: string | null
        }
        Relationships: []
      }
      v_missing_postings: {
        Row: {
          amount: number | null
          doc_date: string | null
          organization_id: string | null
          reference_id: string | null
          reference_type: string | null
        }
        Relationships: []
      }
      v_purchase_vat_summary: {
        Row: {
          grand_total: number | null
          non_vatable_lines: number | null
          order_date: string | null
          organization_id: string | null
          period: string | null
          po_number: string | null
          purchase_order_id: string | null
          subtotal: number | null
          supplier_id: string | null
          tax_total: number | null
          vatable_lines: number | null
        }
        Insert: {
          grand_total?: never
          non_vatable_lines?: never
          order_date?: string | null
          organization_id?: string | null
          period?: never
          po_number?: string | null
          purchase_order_id?: string | null
          subtotal?: never
          supplier_id?: string | null
          tax_total?: never
          vatable_lines?: never
        }
        Update: {
          grand_total?: never
          non_vatable_lines?: never
          order_date?: string | null
          organization_id?: string | null
          period?: never
          po_number?: string | null
          purchase_order_id?: string | null
          subtotal?: never
          supplier_id?: string | null
          tax_total?: never
          vatable_lines?: never
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "purchase_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_unallocated_vendor_payments: {
        Row: {
          allocated: number | null
          amount: number | null
          currency: string | null
          organization_id: string | null
          paid_at: string | null
          payment_id: string | null
          payment_number: string | null
          po_id: string | null
          supplier_id: string | null
          supplier_name: string | null
          unallocated: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "vendor_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_vat_summary"
            referencedColumns: ["purchase_order_id"]
          },
          {
            foreignKeyName: "vendor_payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_unposted_documents: {
        Row: {
          amount: number | null
          currency: string | null
          doc_date: string | null
          doc_id: string | null
          doc_number: string | null
          doc_type: string | null
          organization_id: string | null
        }
        Relationships: []
      }
      v_unrecorded_payments: {
        Row: {
          amount: number | null
          counterparty: string | null
          currency: string | null
          doc_id: string | null
          doc_number: string | null
          doc_type: string | null
          marked_at: string | null
          organization_id: string | null
        }
        Relationships: []
      }
      vendor_payment_unallocated: {
        Row: {
          allocated: number | null
          amount: number | null
          currency: string | null
          organization_id: string | null
          paid_at: string | null
          payment_id: string | null
          payment_number: string | null
          supplier_id: string | null
          unallocated: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "finance_dashboard_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "vendor_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _advance_recurring_expense_template: {
        Args: { _template_id: string }
        Returns: string
      }
      _assert_output_editable: {
        Args: {
          _job: Database["public"]["Tables"]["container_conversions"]["Row"]
        }
        Returns: undefined
      }
      _assert_quote_admin: {
        Args: { _quote_id: string }
        Returns: {
          approval_request_id: string | null
          approval_status: Database["public"]["Enums"]["approval_doc_status"]
          approved_at: string | null
          approved_by: string | null
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          deal_id: string | null
          id: string
          notes: string | null
          organization_id: string
          project_id: string | null
          quote_number: string
          rejection_reason: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          total_amount: number
          valid_until: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _create_expense_from_template: {
        Args: { _run_date: string; _template_id: string }
        Returns: string
      }
      _opex_assert_period_open: {
        Args: { _date: string; _org: string }
        Returns: undefined
      }
      _opex_post_journal: { Args: { _expense_id: string }; Returns: undefined }
      _post_contra_core: { Args: { _sid: string }; Returns: Json }
      acquire_container_from_owner: {
        Args: {
          _amount: number
          _container_id: string
          _currency: string
          _expected_owner?: string
          _fx_rate?: number
          _reason: string
          _reference: string
        }
        Returns: string
      }
      act_on_approval: {
        Args: { _decision: string; _note?: string; _request_id: string }
        Returns: undefined
      }
      add_sub_assembly_stock: {
        Args: {
          _conversion_id: string
          _qty: number
          _stock_id: string
          _unit_cost: number
        }
        Returns: undefined
      }
      adjust_container_acquisition: {
        Args: {
          _container_id: string
          _currency: string
          _delta_amount: number
          _reason: string
          _reference: string
        }
        Returns: string
      }
      adjust_conversion_costs: {
        Args: { _id: string; _new_purchase: number; _new_transport: number }
        Returns: Json
      }
      adjust_sale_costs: {
        Args: { _id: string; _new_purchase: number; _new_transport: number }
        Returns: Json
      }
      adjust_stock: {
        Args: {
          _adjustment_type: Database["public"]["Enums"]["stock_adjustment_type"]
          _from_depot?: string
          _item_id: string
          _item_type: Database["public"]["Enums"]["stock_adjustment_item_type"]
          _new_qty: number
          _reason_category: Database["public"]["Enums"]["stock_adjustment_reason"]
          _reason_text: string
          _to_depot?: string
          _unit_cost?: number
        }
        Returns: {
          adjusted_by: string | null
          adjustment_type: Database["public"]["Enums"]["stock_adjustment_type"]
          created_at: string
          currency: string | null
          from_depot_id: string | null
          gl_journal_id: string | null
          id: string
          item_id: string
          item_label: string | null
          item_type: Database["public"]["Enums"]["stock_adjustment_item_type"]
          organization_id: string
          qty_after: number
          qty_before: number
          qty_delta: number
          reason_category: Database["public"]["Enums"]["stock_adjustment_reason"]
          reason_text: string
          reference: string
          to_depot_id: string | null
          unit_cost: number
          value_delta: number
        }
        SetofOptions: {
          from: "*"
          to: "stock_adjustments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      adjust_stock_batch: { Args: { _items: Json }; Returns: Json }
      admin_adjust_conversion_revenue: {
        Args: { _conversion_id: string; _new_amount: number; _reason: string }
        Returns: Json
      }
      admin_reset_po_status: {
        Args: { _new_status: string; _po_id: string; _reason: string }
        Returns: undefined
      }
      admin_update_container: {
        Args: { _id: string; _patch: Json; _reason: string }
        Returns: undefined
      }
      admin_update_supplier_invoice: {
        Args: { _invoice_id: string; _patch: Json; _reason: string }
        Returns: string
      }
      adopt_legacy_org_data: {
        Args: { _dry_run?: boolean; _target_org: string }
        Returns: Json
      }
      advance_maintenance_plan: {
        Args: { _plan_id: string }
        Returns: undefined
      }
      ai_job_acquire: {
        Args: {
          _job: string
          _lease_seconds?: number
          _org: string
          _worker?: string
        }
        Returns: boolean
      }
      ai_job_release: {
        Args: {
          _error?: string
          _job: string
          _org: string
          _pause?: boolean
          _pause_reason?: string
        }
        Returns: undefined
      }
      ai_job_resume: { Args: { _job: string }; Returns: undefined }
      allocate_receipt_line_to_conversion: {
        Args: { _conversion_id: string; _receipt_item_id: string }
        Returns: Json
      }
      allocate_vendor_payment: {
        Args: { _payment_id: string }
        Returns: number
      }
      allocate_vendor_payment_manual: {
        Args: { _allocations: Json; _payment_id: string; _reason?: string }
        Returns: Json
      }
      allocation_approval_threshold: { Args: { _org: string }; Returns: number }
      apply_loan_payments_to_schedule: {
        Args: { _loan_id: string }
        Returns: undefined
      }
      apply_quote_template: {
        Args: { _mode?: string; _quote_id: string; _template_id: string }
        Returns: number
      }
      apply_repat_rate_card: {
        Args: { _rate_card_id?: string; _repatriation_id: string }
        Returns: string
      }
      apply_section_pack: {
        Args: { _section_id: string; _template_id: string }
        Returns: number
      }
      apply_split_output_allocation: {
        Args: { _conversion_id: string; _reason?: string }
        Returns: Json
      }
      approve_asset_chargeback: {
        Args: { p_issue_id: string; p_notes?: string }
        Returns: string
      }
      approve_attendance_week: {
        Args: { _week_id: string }
        Returns: undefined
      }
      approve_operating_expense: {
        Args: { _expense_id: string; _note?: string }
        Returns: undefined
      }
      approve_payslip: {
        Args: { _comment?: string; _id: string }
        Returns: undefined
      }
      approve_quote: { Args: { _id: string }; Returns: undefined }
      archive_quote: {
        Args: { _quote_id: string; _reason?: string }
        Returns: undefined
      }
      assert_attendance_week_balanced: {
        Args: { _week_id: string }
        Returns: undefined
      }
      attach_container_to_conversion: {
        Args: {
          _container_cost?: number
          _container_id: string
          _conversion_id: string
          _transport_offloading_cost?: number
        }
        Returns: string
      }
      attendance_line_amount: {
        Args: {
          _basis: string
          _days: number
          _employee_id: string
          _hours: number
          _ot: number
        }
        Returns: Record<string, unknown>
      }
      attendance_line_components: {
        Args: {
          _allowance: number
          _basis: string
          _days: number
          _employee_id: string
          _hours: number
          _ot: number
          _work_date?: string
        }
        Returns: Record<string, unknown>
      }
      auto_allocate_vendor_payment: {
        Args: { _payment_id: string }
        Returns: Json
      }
      award_rfq: {
        Args: { _overrides?: Json; _rfq_id: string; _supplier_id: string }
        Returns: string
      }
      backfill_container_transport_costs: {
        Args: {
          _currency?: string
          _dry_run?: boolean
          _rate_20?: number
          _rate_40?: number
          _vendor?: string
        }
        Returns: Json
      }
      backfill_goods_receipt_postings: {
        Args: never
        Returns: {
          posted: boolean
          receipt_id: string
        }[]
      }
      backfill_sale_invoice: { Args: { _sale_id: string }; Returns: string }
      backfill_sales_currency: {
        Args: { _dry_run?: boolean; _org: string }
        Returns: Json
      }
      backfill_trip_revenue_postings: { Args: never; Returns: number }
      bill_gate_in:
        | {
            Args: {
              _amount: number
              _container_id: string
              _currency?: string
              _customer_name: string
            }
            Returns: string
          }
        | {
            Args: {
              _amount: number
              _container_id: string
              _currency?: string
              _customer_name: string
              _source_eir_id?: string
              _source_movement_id?: string
            }
            Returns: string
          }
        | {
            Args: {
              _amount: number
              _container_id: string
              _currency?: string
              _customer_name: string
              _kind?: string
              _source_eir_id?: string
              _source_movement_id?: string
            }
            Returns: string
          }
      bill_repatriation_to_owner: {
        Args: { _repatriation_id: string }
        Returns: string
      }
      bill_unbilled_container_sales: {
        Args: never
        Returns: {
          invoice_id: string
          sale_id: string
        }[]
      }
      budget_variance: {
        Args: { _period_id: string }
        Returns: {
          account_type: string
          actual_amount: number
          budget_amount: number
          code: string
          gl_account_id: string
          name: string
          variance: number
        }[]
      }
      build_sub_assembly: {
        Args: {
          _assembly_stock_id: string
          _notes?: string
          _project_id?: string
          _qty: number
        }
        Returns: string
      }
      bulk_add_quote_items: {
        Args: { _items: Json; _quote_id: string; _section_id: string }
        Returns: number
      }
      bulk_clear_reconciliation_lines: {
        Args: { _reconciliation_id: string; _transaction_ids: string[] }
        Returns: number
      }
      bulk_clear_reconciliation_lines_v2: {
        Args: {
          _line_ids: string[]
          _recon_id: string
          _skip_conflicts?: boolean
        }
        Returns: Json
      }
      can_admin_depot: { Args: { _depot_id: string }; Returns: boolean }
      can_manage_payroll: { Args: never; Returns: boolean }
      can_manage_user_in_org: {
        Args: { _caller: string; _target: string }
        Returns: boolean
      }
      can_view_customer_records: { Args: { _user: string }; Returns: boolean }
      can_view_module: {
        Args: { _module: string; _user: string }
        Returns: boolean
      }
      can_write_module: {
        Args: { _module: string; _user: string }
        Returns: boolean
      }
      cancel_conversion: {
        Args: { _id: string; _reason: string }
        Returns: Json
      }
      canonical_material_category: { Args: { _raw: string }; Returns: string }
      capture_db_load_snapshot: { Args: { p_limit?: number }; Returns: number }
      cashflow_forecast: {
        Args: { _weeks?: number }
        Returns: {
          expected_in: number
          expected_out: number
          net: number
          week_start: string
        }[]
      }
      category_to_gl_code: {
        Args: {
          _account_type: Database["public"]["Enums"]["account_type"]
          _category: string
        }
        Returns: string
      }
      change_user_staff_role: {
        Args: {
          _new_role: Database["public"]["Enums"]["app_role"]
          _target_user_id: string
        }
        Returns: undefined
      }
      check_seat_capacity: {
        Args: { _org: string }
        Returns: {
          can_add: boolean
          seat_limit: number
          used: number
        }[]
      }
      clone_quote_template: {
        Args: { _new_name?: string; _template_id: string }
        Returns: string
      }
      close_fiscal_year: {
        Args: { _fiscal_year: number; _retained_earnings_account: string }
        Returns: string
      }
      commitments_due: {
        Args: { _days?: number }
        Returns: {
          amount: number
          currency: string
          days_until: number
          due_date: string
          kind: string
          source_id: string
          status: string
          title: string
        }[]
      }
      complete_bank_reconciliation: {
        Args: { _id: string }
        Returns: undefined
      }
      complete_conversion: { Args: { _id: string }; Returns: Json }
      compute_tax_return: {
        Args: { _jurisdiction?: string; _period_id: string }
        Returns: {
          input_total: number
          net_payable: number
          output_total: number
        }[]
      }
      consume_sub_assembly:
        | {
            Args: { _conversion_id: string; _csa_id: string; _qty: number }
            Returns: undefined
          }
        | {
            Args: {
              _conversion_id: string
              _csa_id: string
              _qty: number
              _reason?: string
            }
            Returns: undefined
          }
      container_acquisition_split: {
        Args: { _container_id: string; _currency: string }
        Returns: {
          purchase: number
          services: number
        }[]
      }
      container_acquisition_total: {
        Args: { _container_id: string; _currency: string }
        Returns: number
      }
      container_cost_journey: { Args: { _container_id: string }; Returns: Json }
      container_document_owner: {
        Args: { _container_id: string }
        Returns: string
      }
      container_invoice_reconciliation: {
        Args: never
        Returns: {
          acquisition_count: number
          acquisition_invoices: Json
          container_id: string
          container_number: string
          container_size: string
          container_status: string
          duplicate_acquisition_count: number
          duplicate_sale_count: number
          sale_invoice_count: number
          sale_invoices: Json
          severity: string
        }[]
      }
      container_purchase_price: {
        Args: { _container_id: string }
        Returns: {
          amount: number
          currency: string
        }[]
      }
      container_reference_rate: { Args: { _size: string }; Returns: number }
      conversion_budget_variance: {
        Args: { _conversion_id: string }
        Returns: {
          actual_cost: number
          budget_edited_after_use: boolean
          category: string
          cost_variance: number
          description: string
          est_total: number
          est_unit_cost: number
          in_budget: boolean
          issued_qty: number
          material_id: string
          planned_qty: number
          qty_variance: number
          returned_qty: number
          used_qty: number
        }[]
      }
      conversion_direct_expenses: {
        Args: { _conversion_id: string }
        Returns: {
          amount: number
          amount_base: number
          category: string
          currency: string
          description: string
          expense_date: string
          expense_id: string
          expense_number: string
          fx_rate: number
          line_id: string
          payee: string
          tax_amount: number
        }[]
      }
      conversion_eir_costs: {
        Args: { _conversion_id: string }
        Returns: {
          approval_status: string
          container_id: string
          container_number: string
          currency: string
          difference: number
          eir_id: string
          eir_number: string
          eir_total: number
          gate_fee: number
          pending: boolean
          purchase_price: number
          repair_cost: number
          stored_cost: number
        }[]
      }
      conversion_expense_breakdown: {
        Args: { _conversion_id: string }
        Returns: {
          amount: number
          amount_base: number
          approval_status: string
          category: string
          counted: boolean
          currency: string
          description: string
          expense_date: string
          expense_id: string
          expense_number: string
          line_id: string
          payee: string
          posted: boolean
          reversed: boolean
          source: string
        }[]
      }
      conversion_material_cost_expensed: {
        Args: { _conversion_id: string }
        Returns: number
      }
      conversion_material_procurement_status: {
        Args: { _conversion_id: string }
        Returns: {
          material_id: string
          needed_by: string
          ordered_qty: number
          po_number: string
          po_status: string
          purchase_order_id: string
          received_qty: number
          request_id: string
          request_status: string
          requested_qty: number
          urgency: string
        }[]
      }
      conversion_pending_expenses: {
        Args: { _conversion_id: string }
        Returns: {
          amount: number
          approval_status: string
          currency: string
          expense_date: string
          expense_id: string
          expense_number: string
          payee: string
          posted: boolean
          reversed: boolean
        }[]
      }
      conversion_posting_status: {
        Args: { _conversion_id: string }
        Returns: {
          job_cost_total: number
          job_status: string
          last_posted_at: string
          posted_amount: number
          posted_entries: number
        }[]
      }
      conversion_project_expenses: {
        Args: { _conversion_id: string }
        Returns: {
          amount: number
          amount_base: number
          approval_status: string
          category: string
          currency: string
          description: string
          expense_date: string
          expense_id: string
          expense_number: string
          fx_rate: number
          line_id: string
          payee: string
          posted: boolean
          project_job_count: number
          reversed: boolean
          tax_amount: number
        }[]
      }
      conversion_purchase_orders: {
        Args: { _conversion_id: string }
        Returns: {
          allocated_lines: number
          currency: string
          order_date: string
          ordered_qty: number
          po_id: string
          po_number: string
          received_qty: number
          status: string
          supplier_name: string
          total_cost: number
          unallocated_lines: number
          via_project: boolean
        }[]
      }
      convert_requisition_to_po: {
        Args: {
          _request_id: string
          _supplier_id: string
          _unit_price?: number
        }
        Returns: string
      }
      convert_to_base: {
        Args: {
          _amount: number
          _as_of?: string
          _from_ccy: string
          _org_id: string
        }
        Returns: number
      }
      correct_acquisition_invoice_supplier: {
        Args: {
          _amount?: number
          _currency?: string
          _fx_rate?: number
          _invoice_id: string
          _reason: string
          _supplier_id: string
        }
        Returns: Json
      }
      correct_attendance_line: {
        Args: {
          _allowance: number
          _allowance_label: string
          _conversion_id: string
          _days: number
          _hours: number
          _line_id: string
          _overtime_hours: number
          _project_id: string
          _reason: string
        }
        Returns: string
      }
      correct_container_number: {
        Args: { _container_id: string; _new_number: string; _reason: string }
        Returns: number
      }
      correct_container_owner: {
        Args: { _container_id: string; _new_owner: string; _reason: string }
        Returns: boolean
      }
      counterparty_position: {
        Args: { _customer_id?: string; _supplier_id?: string }
        Returns: Json
      }
      counterparty_reconciliation: { Args: never; Returns: Json }
      create_bundled_supplier_invoice: {
        Args: {
          _currency: string
          _issue_date: string
          _lines: Json
          _reason: string
          _supplier_id: string
          _supplier_ref: string
        }
        Returns: string
      }
      create_loan_facility: {
        Args: {
          _currency?: string
          _date_granted: string
          _financial_account_id?: string
          _fixed_asset_id?: string
          _frequency?: string
          _interest_rate: number
          _lender_name: string
          _loan_type: Database["public"]["Enums"]["loan_type"]
          _maturity_date?: string
          _notes?: string
          _payment_day?: number
          _post_disbursement?: boolean
          _principal: number
          _reference?: string
          _repayment_amount?: number
          _supplier_id?: string
        }
        Returns: string
      }
      create_project_from_conversion: {
        Args: { _conversion_id: string }
        Returns: string
      }
      create_rfq: { Args: { _payload: Json }; Returns: string }
      currency_digits: { Args: { _code: string }; Returns: number }
      current_org_id: { Args: never; Returns: string }
      customer_slug_for_conversion: {
        Args: { _customer_id: string }
        Returns: string
      }
      customer_statement: {
        Args: { _customer: string; _from: string; _to: string }
        Returns: {
          credit: number
          currency: string
          debit: number
          description: string
          doc_date: string
          doc_number: string
          doc_type: string
        }[]
      }
      decide_approval_request: {
        Args: { _decision: string; _notes?: string; _request_id: string }
        Returns: Json
      }
      decide_finance_approval: {
        Args: { _decision: string; _note?: string; _request_id: string }
        Returns: Json
      }
      decide_goods_receipt_variance: {
        Args: { _decision: string; _note: string; _receipt_id: string }
        Returns: Json
      }
      decide_material_requisition: {
        Args: { _approve: boolean; _reason?: string; _request_id: string }
        Returns: undefined
      }
      delete_attendance_line: { Args: { _line_id: string }; Returns: undefined }
      delete_conversion_output: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_loan_transaction: { Args: { _txn_id: string }; Returns: undefined }
      delete_quote: {
        Args: { _quote_id: string; _reason: string }
        Returns: undefined
      }
      depot_kpis: { Args: { _depot_id: string }; Returns: Json }
      depot_legal_name: { Args: { _org?: string }; Returns: string }
      detach_container_from_conversion: {
        Args: { _link_id: string; _reason?: string }
        Returns: undefined
      }
      duplicate_acquisition_audit: {
        Args: never
        Returns: {
          container_id: string
          container_number: string
          created_at: string
          currency: string
          invoice_id: string
          invoice_number: string
          issue: string
          keeps_invoice: string
          paid_amount: number
          reason: string
          reference: string
          status: string
          supplier_name: string
          total_amount: number
        }[]
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      employee_deductions: {
        Args: { _employee_id: string; _freq: string; _gross: number }
        Returns: {
          amount: number
          dtype: string
          name: string
        }[]
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      ensure_attendance_week: { Args: { _week_start: string }; Returns: string }
      ensure_bank_charges_category: { Args: { _org: string }; Returns: string }
      ensure_contra_clearing_account: {
        Args: { _currency: string; _org: string }
        Returns: string
      }
      ensure_default_coa: { Args: { _org_id: string }; Returns: undefined }
      ensure_default_expense_categories: {
        Args: { _org_id: string }
        Returns: number
      }
      ensure_default_financial_accounts: {
        Args: { _org: string }
        Returns: undefined
      }
      ensure_fiscal_year: { Args: { _year: number }; Returns: number }
      ensure_loan_gl_account: {
        Args: {
          _code: string
          _name: string
          _org: string
          _type: Database["public"]["Enums"]["account_type"]
        }
        Returns: string
      }
      ensure_stock_adj_gl_account: {
        Args: {
          _code: string
          _name: string
          _org: string
          _type: Database["public"]["Enums"]["account_type"]
        }
        Returns: string
      }
      ensure_supplier_invoice_for_po: {
        Args: { _po_id: string }
        Returns: string
      }
      evaluate_approval_required: {
        Args: {
          _amount: number
          _created_by: string
          _doc_type: string
          _org_id: string
        }
        Returns: {
          assignee: string
          required: boolean
        }[]
      }
      execute_payroll_run: {
        Args: {
          _division: string
          _idempotency_key: string
          _period_end: string
          _period_start: string
        }
        Returns: string
      }
      expire_trials: { Args: never; Returns: number }
      extend_trial: { Args: { _days: number; _org_id: string }; Returns: Json }
      fal_write: {
        Args: {
          _action: string
          _after: Json
          _before: Json
          _entity: string
          _entity_id: string
          _org: string
          _ref: string
          _route: string
          _summary: Json
        }
        Returns: undefined
      }
      finance_currency_difference: {
        Args: { _currency: string }
        Returns: number
      }
      finance_module_feed_status: {
        Args: never
        Returns: {
          documents: number
          last_posted: string
          module: string
          posted: number
          unposted: number
        }[]
      }
      finance_trial_balance: {
        Args: { _currency?: string }
        Returns: {
          account_type: string
          balance: number
          credit: number
          currency: string
          debit: number
          entries: number
          gl_code: string
          gl_name: string
        }[]
      }
      finance_unbalanced_documents: {
        Args: never
        Returns: {
          credit: number
          currency: string
          debit: number
          difference: number
          entries: number
          last_posted: string
          reference_id: string
          reference_type: string
        }[]
      }
      finance_watchdog_detect: {
        Args: { _org: string }
        Returns: {
          amount: number
          currency: string
          dedupe_key: string
          details: Json
          entity_id: string
          entity_label: string
          entity_table: string
          finding_type: string
          severity: string
          title: string
        }[]
      }
      finance_watchdog_scan: { Args: { _org?: string }; Returns: Json }
      find_or_create_customer_by_name: {
        Args: { _name: string; _org: string }
        Returns: string
      }
      gate_dashboard: { Args: { _from: string; _to: string }; Returns: Json }
      gate_in_imported_container: {
        Args: { _container_number: string; _payload: Json }
        Returns: Json
      }
      gate_in_reconciliation: {
        Args: {
          _depot_id?: string
          _from?: string
          _owner?: string
          _to?: string
        }
        Returns: {
          billed_amount: number
          container_id: string
          container_number: string
          expected_amount: number
          expected_currency: string
          gate_in_at: string
          invoice_id: string
          invoice_number: string
          invoice_status: string
          movement_id: string
          owner: string
          paid_amount: number
          reconciliation_state: string
          shipping_line: string
          variance: number
        }[]
      }
      gate_in_upsert_container: { Args: { _payload: Json }; Returns: string }
      gate_out_finished_product: {
        Args: {
          _checklist: Json
          _driver_name: string
          _driver_phone: string
          _finished_product_id: string
          _indemnity_signer: string
          _notes: string
          _transporter: string
          _truck_plate: string
        }
        Returns: string
      }
      gate_out_imported_container: {
        Args: { _container_number: string; _payload: Json }
        Returns: Json
      }
      gate_out_upsert_container: { Args: { _payload: Json }; Returns: string }
      generate_due_recurring_expenses: {
        Args: { _org_id?: string }
        Returns: number
      }
      generate_due_recurring_transfers: { Args: never; Returns: number }
      generate_gate_in_edi: { Args: { _invoice_id: string }; Returns: string }
      generate_invoice_from_quote: {
        Args: { _quote_id: string }
        Returns: {
          already_existed: boolean
          invoice_id: string
          invoice_number: string
        }[]
      }
      generate_lease_invoices: {
        Args: { _period_end: string; _period_start: string }
        Returns: number
      }
      generate_loan_schedule: { Args: { _loan_id: string }; Returns: number }
      generate_monthly_wage_payslips: {
        Args: { _month_start: string }
        Returns: number
      }
      generate_platform_invoices: {
        Args: { _period_end: string; _period_start: string }
        Returns: {
          invoices_created: number
          total_amount: number
        }[]
      }
      generate_repatriation_handling_invoice: {
        Args: {
          _amount?: number
          _currency?: string
          _customer_name?: string
          _repatriation_ids?: string[]
        }
        Returns: {
          invoice_id: string
          invoice_number: string
          line_count: number
          total_amount: number
        }[]
      }
      generate_repatriation_transfer_invoice:
        | {
            Args: {
              _amount?: number
              _currency?: string
              _customer_name?: string
              _repatriation_ids?: string[]
            }
            Returns: {
              invoice_id: string
              invoice_number: string
              line_count: number
              total_amount: number
            }[]
          }
        | {
            Args: {
              _amount?: number
              _amounts?: number[]
              _currency?: string
              _customer_name?: string
              _repatriation_ids?: string[]
            }
            Returns: {
              invoice_id: string
              invoice_number: string
              line_count: number
              total_amount: number
            }[]
          }
      generate_supplier_invoice_edi: {
        Args: { _supplier_invoice_id: string }
        Returns: string
      }
      get_accounting_policy: { Args: never; Returns: Json }
      get_db_load_spikes: {
        Args: {
          p_growth_factor?: number
          p_limit?: number
          p_min_total_ms?: number
        }
        Returns: {
          call_delta: number
          curr_at: string
          curr_calls: number
          curr_total_ms: number
          delta_total_ms: number
          growth_factor: number
          prev_at: string
          prev_calls: number
          prev_total_ms: number
          query_text: string
          queryid: number
        }[]
      }
      get_fx_rate: {
        Args: { _from: string; _on: string; _org: string; _to: string }
        Returns: number
      }
      get_fx_rate_detail: {
        Args: { _from: string; _on: string; _org: string; _to: string }
        Returns: Json
      }
      get_invitation_preview: { Args: { _token_hash: string }; Returns: Json }
      get_portal_customer_id: { Args: { _user_id: string }; Returns: string }
      get_top_db_queries: {
        Args: { p_limit?: number }
        Returns: {
          calls: number
          max_ms: number
          mean_ms: number
          query_text: string
          queryid: number
          rows: number
          total_ms: number
        }[]
      }
      get_user_view_modules: { Args: { _user_id: string }; Returns: string[] }
      gr_post_approved_stock: {
        Args: { _receipt_id: string }
        Returns: undefined
      }
      has_permission: {
        Args: {
          _action: Database["public"]["Enums"]["app_action"]
          _module: string
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_loan_statement: {
        Args: { _loan_id: string; _rows: Json }
        Returns: Json
      }
      insert_section_pack_into_template: {
        Args: {
          _pack_template_id: string
          _qty_multiplier?: number
          _target_template_id: string
          _title_prefix?: string
        }
        Returns: {
          new_section_id: string
        }[]
      }
      invoice_balance: { Args: { _invoice_id: string }; Returns: number }
      is_active_org_member: { Args: { _org: string }; Returns: boolean }
      is_org_admin: { Args: { _org_id: string }; Returns: boolean }
      is_own_company_name: {
        Args: { _name: string; _org: string }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      issue_asset: {
        Args: {
          p_asset_id: string
          p_condition_out?: Database["public"]["Enums"]["asset_issue_condition"]
          p_condition_out_notes?: string
          p_expected_return_at?: string
          p_issued_to_customer_id?: string
          p_issued_to_employee_id?: string
          p_issued_to_name?: string
          p_photos_out?: Json
          p_purpose?: string
          p_work_order_id?: string
        }
        Returns: string
      }
      issue_gate_fee_invoice: {
        Args: { _invoice_id: string }
        Returns: undefined
      }
      issue_material_to_job: {
        Args: {
          _allow_negative?: boolean
          _conversion_id: string
          _material_id: string
          _note?: string
          _qty: number
          _reason?: string
        }
        Returns: string
      }
      issue_recurring_invoices: { Args: never; Returns: number }
      link_payslip_payment: {
        Args: { _payslip_id: string; _txn_id: string }
        Returns: undefined
      }
      link_receipt_item_to_material: {
        Args: { _material_id: string; _receipt_item_id: string }
        Returns: Json
      }
      list_self_billed_purchase_invoices: {
        Args: never
        Returns: {
          container_id: string
          container_number: string
          currency: string
          invoice_id: string
          invoice_number: string
          issue_date: string
          reason: string
          status: string
          supplier_id: string
          supplier_name: string
          total_amount: number
        }[]
      }
      loan_balances: {
        Args: never
        Returns: {
          accrued_interest: number
          arrears_amount: number
          currency: string
          fees_charged: number
          interest_charged: number
          interest_paid: number
          lender_name: string
          loan_id: string
          loan_type: Database["public"]["Enums"]["loan_type"]
          maturity_date: string
          next_due_amount: number
          next_due_date: string
          principal_amount: number
          principal_outstanding: number
          principal_repaid: number
          reference: string
          status: Database["public"]["Enums"]["loan_status"]
          stmt_accrued_interest: number
          stmt_arrears: number
          stmt_as_of: string
          stmt_principal_outstanding: number
        }[]
      }
      loan_due_scan: { Args: never; Returns: number }
      loan_interest_breakdown: {
        Args: { _loan_id: string }
        Returns: {
          accrual_variance: number
          accrued_interest: number
          currency: string
          fees_charged: number
          fees_insurance: number
          fees_other: number
          fees_stamp_duty: number
          interest_charged: number
          interest_outstanding: number
          interest_paid: number
          penalty_charged: number
          penalty_outstanding: number
          penalty_paid: number
          stmt_accrued_interest: number
        }[]
      }
      loan_orphan_postings: {
        Args: { _loan_id: string }
        Returns: {
          category: string
          credit_amount: number
          debit_amount: number
          description: string
          posting_id: string
          reference_id: string
          transaction_date: string
        }[]
      }
      loan_statement_reconciliation: {
        Args: { _loan_id: string }
        Returns: {
          amount: number
          description: string
          difference: number
          match_status: string
          posted_amount: number
          posting_count: number
          posts_to_ledger: boolean
          source: string
          txn_date: string
          txn_id: string
          txn_type: string
        }[]
      }
      log_container_acquisition_override: {
        Args: { _changes: Json; _container_id: string; _reason?: string }
        Returns: undefined
      }
      log_org_event: {
        Args: {
          _actor?: string
          _details?: Json
          _event_type: string
          _org_id: string
        }
        Returns: string
      }
      logistics_backfill_unposted_costs: { Args: never; Returns: number }
      logistics_customer_confirm_deposit: {
        Args: { _order_id: string }
        Returns: string
      }
      logistics_customer_dispute_deposit: {
        Args: { _order_id: string; _reason: string }
        Returns: undefined
      }
      logistics_invoice_container_owner: {
        Args: { _order_id: string }
        Returns: string
      }
      logistics_invoice_order: { Args: { _order_id: string }; Returns: string }
      logistics_invoice_order_part: {
        Args: { _order_id: string; _part: string }
        Returns: string
      }
      logistics_next_ref: { Args: { _prefix: string }; Returns: string }
      logistics_post_trip_cost: { Args: { _cost_id: string }; Returns: string }
      logistics_propose_deposit:
        | { Args: { _order_id: string }; Returns: string }
        | { Args: { _amount?: number; _order_id: string }; Returns: string }
      logistics_run_batch_billing:
        | {
            Args: { _customer_id: string; _from: string; _to: string }
            Returns: string
          }
        | {
            Args: {
              _currency: string
              _customer_id: string
              _from: string
              _to: string
            }
            Returns: string
          }
      logistics_staff_confirm_deposit_and_pay: {
        Args: {
          _account_id: string
          _amount: number
          _method?: Database["public"]["Enums"]["payment_method"]
          _notes?: string
          _order_id: string
          _paid_at?: string
          _reference?: string
        }
        Returns: string
      }
      lookup_gate_in_fee: {
        Args: { _container_id: string }
        Returns: {
          amount: number
          currency: string
        }[]
      }
      lookup_repat_rate: {
        Args: {
          _destination: string
          _on?: string
          _origin: string
          _shipping_line?: string
          _size: string
        }
        Returns: {
          currency: string
          handling_fee: number
          rate_amount: number
          rate_card_id: string
        }[]
      }
      lookup_repat_transfer_fee: {
        Args: {
          _as_of?: string
          _container_size: string
          _destination: string
          _origin: string
        }
        Returns: {
          currency: string
          rate_card_id: string
          transfer_fee: number
        }[]
      }
      manual_allocate_vendor_payment: {
        Args: {
          _amount: number
          _payment_id: string
          _supplier_invoice_id: string
        }
        Returns: Json
      }
      mark_edi_downloaded: { Args: { _export_id: string }; Returns: undefined }
      mark_repatriation_invoice_paid: {
        Args: {
          _account_id: string
          _method?: Database["public"]["Enums"]["payment_method"]
          _notes?: string
          _paid_at?: string
          _reference?: string
          _repatriation_id: string
        }
        Returns: string
      }
      mark_supplier_invitation: {
        Args: { _reason?: string; _rfq_supplier_id: string; _status: string }
        Returns: undefined
      }
      merge_materials: {
        Args: { _from: string; _into: string }
        Returns: string
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      next_conversion_number: {
        Args: { _customer: string; _org: string }
        Returns: string
      }
      next_edi_interchange_ref: { Args: { _org: string }; Returns: string }
      next_eir_number: { Args: { prefix?: string }; Returns: string }
      next_operating_expense_number: { Args: never; Returns: string }
      next_org_container_number: {
        Args: { _kind?: string; _org: string }
        Returns: string
      }
      next_platform_invoice_number: {
        Args: { _period_start: string }
        Returns: string
      }
      next_rfq_number: { Args: { _org: string }; Returns: string }
      next_stock_adj_reference: { Args: { _org: string }; Returns: string }
      notify_approval_target: {
        Args: {
          _doc_id: string
          _doc_type: string
          _message: string
          _org_id: string
          _title: string
          _user_id: string
        }
        Returns: undefined
      }
      notify_payslip_event: {
        Args: { _event: string; _payslip_id: string }
        Returns: undefined
      }
      open_fiscal_year: { Args: { _year: number }; Returns: number }
      opex_budget_vs_actual: {
        Args: { _depot_id?: string; _project_id?: string; _year: number }
        Returns: {
          account_type: string
          actual_amount: number
          budget_amount: number
          category_id: string
          category_name: string
          code: string
          gl_account_id: string
          month: number
          name: string
          variance_amount: number
          variance_pct: number
        }[]
      }
      opex_pl_reconciliation: {
        Args: { _from: string; _to: string }
        Returns: {
          amount: number
          count_value: number
          label: string
          metric: string
        }[]
      }
      org_active_user_count: { Args: { _org_id: string }; Returns: number }
      org_audit_feed: {
        Args: { _before?: string; _limit?: number; _org_id: string }
        Returns: {
          action: string
          actor_id: string
          entity: string
          ref_id: string
          summary: Json
          ts: string
        }[]
      }
      org_has_module: {
        Args: { _code: string; _org_id: string }
        Returns: boolean
      }
      org_subscription_active: { Args: { _org: string }; Returns: boolean }
      org_usage_metrics: {
        Args: { _days?: number; _org_id: string }
        Returns: Json
      }
      override_invoice_currency: {
        Args: {
          _invoice_id: string
          _kind: string
          _new_currency: string
          _reason: string
        }
        Returns: undefined
      }
      pay_attendance_week: {
        Args: { _from_account_id: string; _week_id: string }
        Returns: undefined
      }
      pay_loan_instalment: {
        Args: {
          _description?: string
          _external_ref?: string
          _financial_account_id?: string
          _loan_id: string
          _schedule_line_id: string
          _total_amount?: number
          _txn_date?: string
        }
        Returns: Json
      }
      pay_operating_expense: {
        Args: {
          _amount: number
          _expense_id: string
          _financial_account_id: string
          _payment_date?: string
        }
        Returns: undefined
      }
      pay_payslip: {
        Args: { _from_account_id: string; _id: string }
        Returns: undefined
      }
      payslips_recalc_totals: {
        Args: { _payslip_id: string }
        Returns: undefined
      }
      portal_decide_eir: {
        Args: { _decision: string; _eir_id: string; _note?: string }
        Returns: Json
      }
      portal_pending_eirs: {
        Args: never
        Returns: {
          approval_status: string
          condition_grade: string
          container_number: string
          container_size: string
          created_at: string
          eir_number: string
          eir_type: string
          gate_fee_amount: number
          gate_fee_currency: string
          id: string
          new_owner: string
          owner_at_issue: string
        }[]
      }
      post_asset_disposal: { Args: { _disposal_id: string }; Returns: string }
      post_bank_charge_expense: {
        Args: {
          _account_id: string
          _amount: number
          _currency?: string
          _date: string
          _fx_rate?: number
          _note?: string
          _reference?: string
          _supplier_id?: string
        }
        Returns: string
      }
      post_container_sale_to_ledger: {
        Args: { _id: string }
        Returns: undefined
      }
      post_contra_settlement: {
        Args: {
          _account_id?: string
          _amount: number
          _bank_charge?: number
          _bank_charge_note?: string
          _cash_amount?: number
          _currency: string
          _evidence_ref?: string
          _fx_rate?: number
          _notes?: string
          _settled_on?: string
          _supplier_id: string
        }
        Returns: Json
      }
      post_currency_balancing_journal: {
        Args: { _currency: string; _reason?: string }
        Returns: string
      }
      post_depreciation_run_to_ledger: {
        Args: { _id: string }
        Returns: undefined
      }
      post_expense_claim_to_ledger: {
        Args: { _id: string }
        Returns: undefined
      }
      post_goods_receipt_to_ledger: {
        Args: { _id: string }
        Returns: undefined
      }
      post_inter_account_transfer: { Args: { _id: string }; Returns: undefined }
      post_invoice_to_ledger: {
        Args: { _invoice_id: string }
        Returns: undefined
      }
      post_journal: {
        Args: {
          _currency: string
          _description: string
          _entry_date: string
          _lines: Json
          _reference: string
        }
        Returns: string
      }
      post_loan_transaction: {
        Args: {
          _amount: number
          _description?: string
          _external_ref?: string
          _financial_account_id?: string
          _loan_id: string
          _source?: string
          _statement_balance?: number
          _txn_date: string
          _txn_type: Database["public"]["Enums"]["loan_txn_type"]
        }
        Returns: string
      }
      post_material_consumption_to_ledger: {
        Args: { _movement_id: string }
        Returns: undefined
      }
      post_operating_expense: {
        Args: {
          _attachment_url?: string
          _conversion_id?: string
          _currency?: string
          _depot_id?: string
          _due_date?: string
          _expense_date: string
          _financial_account_id?: string
          _fx_rate?: number
          _lines: Json
          _notes?: string
          _payee?: string
          _payment_mode: string
          _project_id?: string
          _reference?: string
          _submit?: boolean
          _supplier_id?: string
        }
        Returns: string
      }
      post_payment_to_ledger: {
        Args: { _payment_id: string }
        Returns: undefined
      }
      post_payslip: { Args: { _id: string }; Returns: string }
      post_payslip_to_ledger: { Args: { _id: string }; Returns: undefined }
      post_petty_cash_voucher_to_ledger: {
        Args: { _id: string }
        Returns: undefined
      }
      post_receipt_stock: { Args: { _receipt_id: string }; Returns: undefined }
      post_repatriation_cost_to_ledger: {
        Args: { _id: string }
        Returns: undefined
      }
      post_tax_return: {
        Args: { _jurisdiction?: string; _period_id: string }
        Returns: string
      }
      post_trip_cost_to_ledger: { Args: { _id: string }; Returns: undefined }
      post_trip_revenue_to_ledger: { Args: { _id: string }; Returns: undefined }
      post_vendor_payment_to_ledger: {
        Args: { _id: string }
        Returns: undefined
      }
      post_withholding_to_ledger: { Args: { _id: string }; Returns: undefined }
      preview_acquisition_recipient: {
        Args: { _container_id: string; _expected_owner?: string }
        Returns: {
          buyer_name: string
          note: string
          owner: string
          source: string
        }[]
      }
      preview_container_acquisition_costs: {
        Args: {
          _container_id: string
          _offloading?: number
          _offloading_currency?: string
          _offloading_fx?: number
          _offloading_vendor?: string
          _purchase?: number
          _purchase_currency?: string
          _purchase_fx?: number
          _transport?: number
          _transport_currency?: string
          _transport_fx?: number
          _transport_vendor?: string
        }
        Returns: Json
      }
      preview_contra_settlement: {
        Args: { _supplier_id: string }
        Returns: Json
      }
      preview_conversion_container_resync: {
        Args: { _conversion_id?: string }
        Returns: {
          container_id: string
          container_number: string
          conversion_id: string
          conversion_number: string
          currency: string
          delta: number
          error: string
          job_status: string
          link_id: string
          live_purchase: number
          live_transport: number
          stored_purchase: number
          stored_transport: number
        }[]
      }
      preview_depot_retirement: {
        Args: { _depot_id: string; _target_hq_id: string }
        Returns: Json
      }
      preview_party_currency_impact: {
        Args: { _new_currency: string; _party_id: string; _party_kind: string }
        Returns: Json
      }
      preview_repatriation_bill: {
        Args: { _repatriation_id: string }
        Returns: {
          already_invoiced: boolean
          currency: string
          gate_in: number
          handling: number
          owner: string
          repat_fee: number
          storage: number
          storage_days: number
        }[]
      }
      preview_repatriation_handling_invoice: {
        Args: { _customer_name?: string; _repatriation_ids?: string[] }
        Returns: {
          amount: number
          container_number: string
          currency: string
          eligible: boolean
          exclusion_reason: string
          repatriation_id: string
          repatriation_number: string
          status: string
        }[]
      }
      preview_repatriation_transfer_invoice: {
        Args: {
          _amount?: number
          _customer_name?: string
          _repatriation_ids?: string[]
        }
        Returns: {
          amount: number
          container_number: string
          currency: string
          eligible: boolean
          exclusion_reason: string
          repatriation_id: string
          repatriation_number: string
          status: string
        }[]
      }
      preview_supplier_payment_allocation: {
        Args: { _amount: number; _currency?: string; _supplier_id: string }
        Returns: Json
      }
      project_pnl_report: {
        Args: { _from?: string; _to?: string }
        Returns: {
          budget: number
          code: string
          customer_id: string
          customer_name: string
          expenses: number
          gross_profit: number
          materials: number
          name: string
          net_profit: number
          other_cogs: number
          project_id: string
          quoted: number
          revenue: number
          status: string
          variance: number
        }[]
      }
      prune_public_request_log: { Args: never; Returns: undefined }
      raise_material_requisition: {
        Args: {
          _conversion_id: string
          _description: string
          _material_id: string
          _needed_by?: string
          _note?: string
          _qty: number
          _urgency?: string
        }
        Returns: string
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      realtime_topic_is_sensitive: {
        Args: { _topic: string }
        Returns: boolean
      }
      reassign_approval_request: {
        Args: { _new_assignee: string; _note?: string; _request_id: string }
        Returns: Json
      }
      recalc_attendance_week: { Args: { _week_id: string }; Returns: undefined }
      recalc_po_totals: { Args: { _po_id: string }; Returns: undefined }
      recalc_sub_assembly_bom_cost: {
        Args: { _assembly_stock_id: string }
        Returns: number
      }
      receive_po_with_variances: {
        Args: { _lines: Json; _notes: string; _po_id: string }
        Returns: Json
      }
      recompute_split_output_costs: {
        Args: { _conversion_id: string; _reason: string }
        Returns: Json
      }
      reconcile_attendance_week: { Args: { _week_id: string }; Returns: Json }
      reconcile_material_stock: {
        Args: { _material_id?: string; _reason?: string }
        Returns: Json
      }
      reconcile_repatriation_ro_mismatches: { Args: never; Returns: number }
      record_asset_chargeback_payment: {
        Args: {
          p_amount: number
          p_issue_id: string
          p_method?: string
          p_notes?: string
          p_paid_at?: string
          p_reference?: string
        }
        Returns: string
      }
      record_container_service_invoice:
        | {
            Args: {
              _amount: number
              _container_id: string
              _currency: string
              _reference?: string
              _service_kind: string
              _vendor_name: string
            }
            Returns: string
          }
        | {
            Args: {
              _amount: number
              _container_id: string
              _currency: string
              _fx_rate?: number
              _reference?: string
              _service_kind: string
              _vendor_name: string
            }
            Returns: string
          }
      record_customer_payment: {
        Args: {
          _account_id: string
          _amount: number
          _invoice_id: string
          _method?: Database["public"]["Enums"]["payment_method"]
          _notes?: string
          _paid_at?: string
          _reference?: string
        }
        Returns: string
      }
      record_gate_fee_payment:
        | {
            Args: {
              _account_id: string
              _amount: number
              _invoice_id: string
              _method?: Database["public"]["Enums"]["payment_method"]
              _notes?: string
              _paid_at?: string
              _reference?: string
            }
            Returns: string
          }
        | {
            Args: {
              _amount: number
              _invoice_id: string
              _method?: Database["public"]["Enums"]["payment_method"]
              _notes?: string
              _paid_at?: string
              _reference?: string
            }
            Returns: string
          }
      record_supplier_onaccount_payment: {
        Args: {
          _account_id: string
          _allocations?: Json
          _amount: number
          _bank_charge?: number
          _bank_charge_note?: string
          _currency?: string
          _fx_rate?: number
          _method: Database["public"]["Enums"]["payment_method"]
          _notes: string
          _paid_at: string
          _reference: string
          _skip_approval?: boolean
          _supplier_id: string
        }
        Returns: Json
      }
      record_supplier_quote: {
        Args: { _quotes: Json; _rfq_supplier_id: string }
        Returns: undefined
      }
      record_vendor_payment: {
        Args: {
          _account_id: string
          _amount: number
          _bank_charge?: number
          _bank_charge_note?: string
          _currency?: string
          _fx_rate?: number
          _method: Database["public"]["Enums"]["payment_method"]
          _notes: string
          _paid_at: string
          _po_id: string
          _reference: string
        }
        Returns: string
      }
      refresh_supplier_invoice_paid: {
        Args: { _invoice_id: string }
        Returns: undefined
      }
      reject_asset_chargeback: {
        Args: { p_issue_id: string; p_reason: string }
        Returns: undefined
      }
      reject_operating_expense: {
        Args: { _expense_id: string; _reason: string }
        Returns: undefined
      }
      reject_payslip: {
        Args: { _comment?: string; _id: string }
        Returns: undefined
      }
      reject_quote: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      remove_conversion_child_container: {
        Args: { _container_id: string; _reason: string }
        Returns: undefined
      }
      repair_missing_postings: { Args: never; Returns: Json }
      repat_profitability: {
        Args: { _from?: string; _to?: string }
        Returns: {
          allocated_trip_cost: number
          carrier_cost: number
          carrier_cost_converted: number
          carrier_cost_currency: string
          carrier_fx_ok: boolean
          charge_amount: number
          container_number: string
          cost_basis: string
          currency: string
          destination: string
          direct_cost: number
          execution_mode: string
          fx_ok: boolean
          handling_amount: number
          invoice_id: string
          invoice_number: string
          invoice_status: string
          invoice_total: number
          margin: number
          margin_pct: number
          origin: string
          repatriation_id: string
          repatriation_number: string
          revenue: number
          shipping_line: string
          status: string
        }[]
      }
      repatriation_handling_reconciliation: {
        Args: never
        Returns: {
          amount: number
          container_number: string
          currency: string
          handling_invoice_number: string
          issue: string
          repatriation_id: string
          repatriation_number: string
        }[]
      }
      report_summary: { Args: { _days?: number }; Returns: Json }
      repost_loan_transaction: { Args: { _txn_id: string }; Returns: number }
      request_depot_hq_promotion: { Args: { _depot_id: string }; Returns: Json }
      request_depot_retirement: {
        Args: { _depot_id: string; _preview?: Json; _target_hq_id: string }
        Returns: Json
      }
      request_quote_approval: { Args: { _id: string }; Returns: undefined }
      request_signup_resend: { Args: { _email: string }; Returns: Json }
      resend_supplier_invitation: {
        Args: { _channel?: string; _rfq_supplier_id: string }
        Returns: undefined
      }
      resolve_eir_ownership: {
        Args: { _container_id: string; _new_owner?: string }
        Returns: Json
      }
      resolve_reconciliation_conflict: {
        Args: { _action: string; _line_id: string; _note?: string }
        Returns: undefined
      }
      restamp_repatriation_invoice_currency: {
        Args: { _repatriation_id: string }
        Returns: string
      }
      restart_trial: { Args: { _org_id: string }; Returns: Json }
      restore_quote_template_version: {
        Args: { _version_id: string }
        Returns: string
      }
      resync_conversion_container_costs: {
        Args: {
          _container_id?: string
          _conversion_id: string
          _reason: string
        }
        Returns: Json
      }
      resync_conversion_container_costs_from_eir: {
        Args: {
          _container_id?: string
          _conversion_id: string
          _reason: string
        }
        Returns: Json
      }
      resync_conversion_project_txns: {
        Args: { _conversion_id: string }
        Returns: number
      }
      retire_depot: {
        Args: {
          _confirm_reconciled?: boolean
          _depot_id: string
          _target_hq_id: string
        }
        Returns: Json
      }
      return_asset: {
        Args: {
          p_condition_in: Database["public"]["Enums"]["asset_issue_condition"]
          p_condition_in_notes?: string
          p_damage_charge?: number
          p_issue_id: string
          p_mark_lost?: boolean
          p_photos_in?: Json
          p_received_by_employee_id?: string
        }
        Returns: undefined
      }
      return_material_from_job: {
        Args: {
          _conversion_id: string
          _material_id: string
          _note?: string
          _qty: number
          _reason?: string
        }
        Returns: string
      }
      return_sub_assembly: {
        Args: {
          _conversion_id: string
          _csa_id: string
          _qty: number
          _reason?: string
        }
        Returns: undefined
      }
      revalue_acquisition_fx: {
        Args: { _as_of?: string; _currency_from?: string }
        Returns: Json
      }
      reverse_container_terminal_status: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      reverse_contra_settlement: {
        Args: { _reason: string; _settlement_id: string }
        Returns: Json
      }
      reverse_duplicate_acquisition_invoice: {
        Args: { _invoice_id: string; _reason: string }
        Returns: Json
      }
      reverse_operating_expense: {
        Args: { _expense_id: string; _reason: string }
        Returns: undefined
      }
      reverse_payment: {
        Args: { _payment_id: string; _reason: string }
        Returns: string
      }
      review_ai_finding: {
        Args: { _finding_id: string; _note?: string; _status: string }
        Returns: undefined
      }
      revise_payment_allocation_request: {
        Args: { _allocations: Json; _note?: string; _request_id: string }
        Returns: Json
      }
      run_commitment_reminders: { Args: { _days?: number }; Returns: number }
      run_depreciation: { Args: { _period_id: string }; Returns: string }
      run_fx_revaluation: { Args: { _period_id: string }; Returns: string }
      run_recurring_expense_now: {
        Args: { _template_id: string }
        Returns: string
      }
      run_recurring_transfer_now: { Args: { _id: string }; Returns: string }
      save_accounting_policy: {
        Args: {
          _netting_enabled: boolean
          _offset_approval_threshold: number
          _policy_note?: string
          _presentation_basis: string
          _require_setoff_evidence: boolean
          _same_currency_only: boolean
        }
        Returns: Json
      }
      save_quote_as_template: {
        Args: {
          _category?: string
          _description?: string
          _name: string
          _quote_id: string
        }
        Returns: string
      }
      save_section_as_pack: {
        Args: { _category?: string; _name: string; _section_id: string }
        Returns: string
      }
      seed_close_checklist: { Args: { _period_id: string }; Returns: number }
      seed_default_dunning_rules: { Args: { _org: string }; Returns: number }
      seed_default_fx_rates: { Args: { _org: string }; Returns: number }
      seed_default_tax_codes: { Args: { _org: string }; Returns: number }
      sell_sub_assembly: {
        Args: {
          _assembly_stock_id: string
          _buyer_customer_id?: string
          _buyer_name: string
          _notes?: string
          _qty: number
          _unit_price: number
        }
        Returns: string
      }
      set_container_acquisition_costs: {
        Args: {
          _container_id: string
          _currency: string
          _offloading: number
          _offloading_currency?: string
          _offloading_fx?: number
          _offloading_supplier_id?: string
          _offloading_vendor: string
          _purchase: number
          _purchase_currency?: string
          _purchase_fx?: number
          _reason: string
          _transport: number
          _transport_currency?: string
          _transport_fx?: number
          _transport_supplier_id?: string
          _transport_vendor: string
        }
        Returns: Json
      }
      set_depot_as_hq: { Args: { _depot_id: string }; Returns: undefined }
      set_expense_conversion: {
        Args: {
          _conversion_id?: string
          _expense_id: string
          _project_id?: string
        }
        Returns: undefined
      }
      set_member_status: {
        Args: { _member_id: string; _status: string }
        Returns: Json
      }
      set_opex_budget: {
        Args: {
          _amount: number
          _category_id?: string
          _depot_id?: string
          _gl_account_id: string
          _month: number
          _project_id?: string
          _year: number
        }
        Returns: string
      }
      set_period_status: {
        Args: { _period_id: string; _status: string }
        Returns: undefined
      }
      set_repatriation_execution:
        | {
            Args: {
              _carrier_cost?: number
              _carrier_id?: string
              _mode: string
              _repatriation_id: string
              _trip_id?: string
            }
            Returns: undefined
          }
        | {
            Args: {
              _carrier_cost?: number
              _carrier_cost_currency?: string
              _carrier_fx_rate?: number
              _carrier_id?: string
              _mode: string
              _repatriation_id: string
              _trip_id?: string
            }
            Returns: undefined
          }
      set_repatriation_transfer_line_amounts: {
        Args: {
          _amounts: number[]
          _invoice_id: string
          _reason: string
          _repatriation_ids: string[]
        }
        Returns: {
          invoice_id: string
          line_count: number
          total_amount: number
        }[]
      }
      set_sale_pricing: {
        Args: { _id: string; _reason: string; _selling_price: number }
        Returns: Json
      }
      set_supplier_invoice_refs: {
        Args: { _invoice_ids: string[]; _reason: string; _supplier_ref: string }
        Returns: number
      }
      set_user_staff_roles: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _target_user_id: string
        }
        Returns: undefined
      }
      set_vendor_payment_allocations: {
        Args: { _lines: Json; _payment_id: string }
        Returns: number
      }
      settle_operating_expenses: {
        Args: {
          _expense_ids: string[]
          _financial_account_id: string
          _payment_date?: string
          _reference?: string
        }
        Returns: number
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      snapshot_quote: {
        Args: { _event: string; _id: string; _note?: string }
        Returns: string
      }
      snapshot_quote_template: {
        Args: { _note?: string; _template_id: string }
        Returns: string
      }
      split_letter_suffix: { Args: { _n: number }; Returns: string }
      submit_asset_chargeback: {
        Args: { p_amount: number; p_issue_id: string; p_notes?: string }
        Returns: undefined
      }
      submit_for_approval: {
        Args: { _amount?: number; _doc_id: string; _doc_type: string }
        Returns: string
      }
      submit_operating_expense: {
        Args: { _expense_id: string }
        Returns: undefined
      }
      submit_payslip_for_approval: { Args: { _id: string }; Returns: undefined }
      suggest_reconciliation_matches: {
        Args: { _reconciliation_id: string }
        Returns: {
          candidate_transaction_id: string
          conflicts: string[]
          credit_amount: number
          debit_amount: number
          description: string
          score: number
          transaction_date: string
          transaction_number: string
        }[]
      }
      supplier_invoice_cost_in_ledger: {
        Args: { _invoice_id: string }
        Returns: boolean
      }
      supplier_purchase_price_variance: {
        Args: { _from?: string; _to?: string }
        Returns: {
          amount: number
          category: string
          container_id: string
          container_number: string
          currency: string
          invoice_id: string
          invoice_number: string
          issue_date: string
          reference_rate: number
          reference_rate_converted: number
          size: string
          supplier_id: string
          supplier_name: string
          supplier_ref: string
          variance: number
        }[]
      }
      supplier_statement: {
        Args: { _from: string; _supplier: string; _to: string }
        Returns: {
          credit: number
          debit: number
          description: string
          doc_date: string
          doc_number: string
          doc_type: string
        }[]
      }
      swap_conversion_container: {
        Args: {
          _container_cost?: number
          _link_id: string
          _new_container_id: string
          _reason: string
          _transport_offloading_cost?: number
        }
        Returns: string
      }
      sync_attendance_line_to_job: {
        Args: { _line_id: string }
        Returns: undefined
      }
      trip_cost_allocation: {
        Args: { _basis?: string; _trip_id: string }
        Returns: {
          allocated_cost: number
          cost_currency: string
          currency: string
          fx_ok: boolean
          label: string
          margin: number
          revenue: number
          source: string
        }[]
      }
      unaccent: { Args: { "": string }; Returns: string }
      unallocate_vendor_payment: {
        Args: { _allocation_id: string; _reason: string }
        Returns: boolean
      }
      unarchive_quote: { Args: { _quote_id: string }; Returns: undefined }
      undo_bulk_clear: {
        Args: { _line_ids: string[]; _recon_id: string }
        Returns: number
      }
      unlink_repatriation_release: {
        Args: {
          _new_release_order_no: string
          _reason: string
          _repatriation_id: string
        }
        Returns: Json
      }
      update_conversion_child_container: {
        Args: {
          _category: Database["public"]["Enums"]["container_category"]
          _container_id: string
          _height_class: Database["public"]["Enums"]["container_height_class"]
          _notes: string
          _reason: string
          _size: Database["public"]["Enums"]["container_size"]
        }
        Returns: undefined
      }
      update_conversion_output: {
        Args: {
          _category: Database["public"]["Enums"]["container_category"]
          _height_class: Database["public"]["Enums"]["container_height_class"]
          _id: string
          _notes: string
          _planned_count: number
          _reason: string
          _size: Database["public"]["Enums"]["container_size"]
          _target_owner: string
        }
        Returns: undefined
      }
      upsert_attendance_line:
        | {
            Args: {
              _allowance?: number
              _allowance_label?: string
              _conversion_id?: string
              _days?: number
              _employee_id: string
              _hours?: number
              _line_id?: string
              _notes?: string
              _overtime_hours?: number
              _project_id?: string
              _week_id: string
            }
            Returns: string
          }
        | {
            Args: {
              _allowance?: number
              _allowance_label?: string
              _conversion_id?: string
              _days?: number
              _employee_id: string
              _hours?: number
              _line_id?: string
              _notes?: string
              _overtime_hours?: number
              _project_id?: string
              _week_id: string
              _work_date?: string
            }
            Returns: string
          }
      upsert_user_staff_role: {
        Args: {
          _new_role: Database["public"]["Enums"]["app_role"]
          _target_user_id: string
        }
        Returns: undefined
      }
      user_directory_visible_roles: {
        Args: { _user_id: string }
        Returns: string[]
      }
      void_gate_fee_invoice: {
        Args: { _invoice_id: string; _reason?: string }
        Returns: string
      }
      void_inter_account_transfer: { Args: { _id: string }; Returns: undefined }
      void_payslip: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      waive_asset_chargeback: {
        Args: { p_issue_id: string; p_reason: string }
        Returns: undefined
      }
    }
    Enums: {
      account_type:
        | "revenue"
        | "cost_of_goods"
        | "expense"
        | "asset"
        | "liability"
        | "equity"
      app_action:
        | "view"
        | "create"
        | "edit"
        | "delete"
        | "approve"
        | "post"
        | "export"
      app_role:
        | "admin"
        | "yard_operator"
        | "gate_clerk"
        | "viewer"
        | "customer"
        | "accountant"
        | "hr_manager"
        | "production_manager"
        | "procurement_officer"
        | "supply_chain_manager"
        | "sales_manager"
        | "leasing_manager"
        | "mr_supervisor"
        | "asset_manager"
        | "org_owner"
      appointment_status:
        | "scheduled"
        | "confirmed"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "no_show"
      approval_doc_status: "not_required" | "pending" | "approved" | "rejected"
      approval_status: "pending" | "approved" | "rejected" | "revised"
      assembly_type:
        | "door"
        | "window_frame"
        | "panel"
        | "electrical_kit"
        | "plumbing_kit"
        | "insulation_pack"
        | "other"
      asset_chargeback_status:
        | "none"
        | "pending_approval"
        | "approved"
        | "rejected"
        | "invoiced"
        | "partially_paid"
        | "paid"
        | "waived"
      asset_class:
        | "equipment"
        | "vehicle"
        | "facility"
        | "it"
        | "tool"
        | "other"
      asset_condition: "new" | "good" | "fair" | "poor" | "out_of_service"
      asset_disposal_method:
        | "sale"
        | "scrap"
        | "donation"
        | "write_off"
        | "lost"
      asset_issue_condition: "new" | "good" | "fair" | "poor"
      asset_issue_status:
        | "open"
        | "returned"
        | "damaged"
        | "lost"
        | "written_off"
      bank_reconciliation_status: "in_progress" | "completed" | "voided"
      billing_cycle: "monthly" | "annual"
      block_type: "dry" | "reefer" | "hazmat" | "mixed"
      charge_type:
        | "storage"
        | "repair"
        | "handling"
        | "gate_fee"
        | "other"
        | "per_diem"
        | "pickup_fee"
        | "dropoff_fee"
        | "dpp"
        | "redelivery_repair"
        | "loss_value"
      condition_grade: "A" | "B" | "C" | "D"
      container_category: "dry" | "reefer" | "tank" | "flat_rack" | "open_top"
      container_height_class: "HC" | "LC"
      container_size: "20" | "40" | "45" | "10" | "30"
      container_status:
        | "available"
        | "allocated"
        | "damaged"
        | "repair_pending"
        | "in_repair"
        | "hold"
        | "in_conversion"
        | "sold"
        | "booked_for_repatriation"
        | "on_lease"
        | "converted"
      conversion_job_kind: "split" | "product" | "sub_assembly"
      conversion_product_type:
        | "office"
        | "home"
        | "coldroom"
        | "workshop"
        | "ablution"
        | "guard_house"
        | "other"
        | "steel_structure"
        | "fabrication"
      conversion_status: "planning" | "in_progress" | "completed" | "cancelled"
      customer_type: "buyer" | "shipping_line" | "owner" | "agent"
      eir_type: "gate_in" | "gate_out"
      financial_account_type:
        | "bank"
        | "cash"
        | "mobile_money"
        | "credit_card"
        | "other"
      finished_product_status:
        | "in_production"
        | "in_stock"
        | "reserved"
        | "sold"
        | "leased"
        | "scrapped"
      inspection_type: "gate_in" | "periodic" | "pre_delivery" | "damage"
      invoice_status:
        | "draft"
        | "sent"
        | "paid"
        | "overdue"
        | "cancelled"
        | "credited"
      lease_billing_cycle: "weekly" | "monthly"
      lease_quote_status:
        | "pending"
        | "sent"
        | "accepted"
        | "rejected"
        | "expired"
      lease_status:
        | "draft"
        | "quoted"
        | "active"
        | "suspended"
        | "closed"
        | "cancelled"
      lease_type:
        | "master"
        | "long_term"
        | "short_term"
        | "one_way"
        | "spot"
        | "lease_purchase"
      lease_unit_status:
        | "on_hire"
        | "off_hire"
        | "in_transit"
        | "lost"
        | "damaged_total_loss"
      loan_schedule_status:
        | "expected"
        | "part_paid"
        | "paid"
        | "overdue"
        | "cancelled"
      loan_status:
        | "draft"
        | "active"
        | "in_arrears"
        | "restructured"
        | "settled"
        | "written_off"
      loan_txn_type:
        | "disbursement"
        | "charges"
        | "stamp_duty"
        | "insurance"
        | "interest_due"
        | "penalty_interest_due"
        | "principal_payment"
        | "interest_payment"
        | "penalty_payment"
        | "write_off"
        | "adjustment"
      loan_type:
        | "asset_finance"
        | "unsecured"
        | "mortgage"
        | "overdraft"
        | "shareholder"
        | "other"
      logistics_billing_cycle: "weekly" | "biweekly" | "monthly"
      logistics_billing_mode: "per_trip" | "periodic"
      logistics_carrier_type: "internal" | "subcontractor"
      logistics_cost_category:
        | "fuel"
        | "driver_allowance"
        | "tolls"
        | "parking"
        | "repairs"
        | "subcontractor"
        | "loading"
        | "permits"
        | "other"
        | "driver_salary"
        | "mileage"
      logistics_order_status:
        | "draft"
        | "confirmed"
        | "assigned"
        | "in_transit"
        | "delivered"
        | "invoiced"
        | "cancelled"
      logistics_order_type: "shuttle" | "custom"
      logistics_rate_type: "per_trip" | "per_km" | "per_container"
      logistics_trip_status:
        | "planned"
        | "dispatched"
        | "in_transit"
        | "completed"
        | "cancelled"
      logistics_vehicle_status:
        | "available"
        | "on_trip"
        | "maintenance"
        | "retired"
      logistics_vehicle_type: "truck" | "trailer" | "prime_mover"
      material_movement_type:
        | "receipt"
        | "issue"
        | "return"
        | "adjustment"
        | "scrap"
      movement_type:
        | "gate_in"
        | "gate_out"
        | "reposition"
        | "stack"
        | "unstack"
        | "repatriation"
      org_member_role:
        | "org_owner"
        | "admin"
        | "yard_operator"
        | "gate_clerk"
        | "viewer"
        | "customer"
      org_member_status: "invited" | "active" | "suspended"
      org_status:
        | "trial"
        | "active"
        | "past_due"
        | "suspended"
        | "cancelled"
        | "free"
      payment_method:
        | "bank_transfer"
        | "cash"
        | "cheque"
        | "credit_card"
        | "other"
      platform_invoice_line_type: "base" | "module" | "seats" | "adjustment"
      platform_invoice_status: "draft" | "sent" | "paid" | "overdue" | "void"
      project_status: "active" | "on_hold" | "completed" | "archived"
      repair_type:
        | "structural"
        | "cosmetic"
        | "mechanical"
        | "electrical"
        | "reefer"
      repatriation_status:
        | "pending"
        | "approved"
        | "dispatched"
        | "completed"
        | "cancelled"
      sale_status: "listed" | "reserved" | "sold" | "cancelled"
      stock_adjustment_item_type:
        | "material"
        | "finished_product"
        | "sub_assembly"
      stock_adjustment_reason:
        | "damage"
        | "loss"
        | "theft"
        | "found"
        | "recount"
        | "correction"
        | "transfer"
        | "other"
      stock_adjustment_type:
        | "count_variance"
        | "write_off"
        | "write_on"
        | "reclassification"
      subscription_status:
        | "trial"
        | "active"
        | "past_due"
        | "suspended"
        | "cancelled"
      wo_priority: "low" | "medium" | "high" | "urgent"
      wo_status: "open" | "in_progress" | "on_hold" | "completed" | "cancelled"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      account_type: [
        "revenue",
        "cost_of_goods",
        "expense",
        "asset",
        "liability",
        "equity",
      ],
      app_action: [
        "view",
        "create",
        "edit",
        "delete",
        "approve",
        "post",
        "export",
      ],
      app_role: [
        "admin",
        "yard_operator",
        "gate_clerk",
        "viewer",
        "customer",
        "accountant",
        "hr_manager",
        "production_manager",
        "procurement_officer",
        "supply_chain_manager",
        "sales_manager",
        "leasing_manager",
        "mr_supervisor",
        "asset_manager",
        "org_owner",
      ],
      appointment_status: [
        "scheduled",
        "confirmed",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
      ],
      approval_doc_status: ["not_required", "pending", "approved", "rejected"],
      approval_status: ["pending", "approved", "rejected", "revised"],
      assembly_type: [
        "door",
        "window_frame",
        "panel",
        "electrical_kit",
        "plumbing_kit",
        "insulation_pack",
        "other",
      ],
      asset_chargeback_status: [
        "none",
        "pending_approval",
        "approved",
        "rejected",
        "invoiced",
        "partially_paid",
        "paid",
        "waived",
      ],
      asset_class: ["equipment", "vehicle", "facility", "it", "tool", "other"],
      asset_condition: ["new", "good", "fair", "poor", "out_of_service"],
      asset_disposal_method: ["sale", "scrap", "donation", "write_off", "lost"],
      asset_issue_condition: ["new", "good", "fair", "poor"],
      asset_issue_status: [
        "open",
        "returned",
        "damaged",
        "lost",
        "written_off",
      ],
      bank_reconciliation_status: ["in_progress", "completed", "voided"],
      billing_cycle: ["monthly", "annual"],
      block_type: ["dry", "reefer", "hazmat", "mixed"],
      charge_type: [
        "storage",
        "repair",
        "handling",
        "gate_fee",
        "other",
        "per_diem",
        "pickup_fee",
        "dropoff_fee",
        "dpp",
        "redelivery_repair",
        "loss_value",
      ],
      condition_grade: ["A", "B", "C", "D"],
      container_category: ["dry", "reefer", "tank", "flat_rack", "open_top"],
      container_height_class: ["HC", "LC"],
      container_size: ["20", "40", "45", "10", "30"],
      container_status: [
        "available",
        "allocated",
        "damaged",
        "repair_pending",
        "in_repair",
        "hold",
        "in_conversion",
        "sold",
        "booked_for_repatriation",
        "on_lease",
        "converted",
      ],
      conversion_job_kind: ["split", "product", "sub_assembly"],
      conversion_product_type: [
        "office",
        "home",
        "coldroom",
        "workshop",
        "ablution",
        "guard_house",
        "other",
        "steel_structure",
        "fabrication",
      ],
      conversion_status: ["planning", "in_progress", "completed", "cancelled"],
      customer_type: ["buyer", "shipping_line", "owner", "agent"],
      eir_type: ["gate_in", "gate_out"],
      financial_account_type: [
        "bank",
        "cash",
        "mobile_money",
        "credit_card",
        "other",
      ],
      finished_product_status: [
        "in_production",
        "in_stock",
        "reserved",
        "sold",
        "leased",
        "scrapped",
      ],
      inspection_type: ["gate_in", "periodic", "pre_delivery", "damage"],
      invoice_status: [
        "draft",
        "sent",
        "paid",
        "overdue",
        "cancelled",
        "credited",
      ],
      lease_billing_cycle: ["weekly", "monthly"],
      lease_quote_status: [
        "pending",
        "sent",
        "accepted",
        "rejected",
        "expired",
      ],
      lease_status: [
        "draft",
        "quoted",
        "active",
        "suspended",
        "closed",
        "cancelled",
      ],
      lease_type: [
        "master",
        "long_term",
        "short_term",
        "one_way",
        "spot",
        "lease_purchase",
      ],
      lease_unit_status: [
        "on_hire",
        "off_hire",
        "in_transit",
        "lost",
        "damaged_total_loss",
      ],
      loan_schedule_status: [
        "expected",
        "part_paid",
        "paid",
        "overdue",
        "cancelled",
      ],
      loan_status: [
        "draft",
        "active",
        "in_arrears",
        "restructured",
        "settled",
        "written_off",
      ],
      loan_txn_type: [
        "disbursement",
        "charges",
        "stamp_duty",
        "insurance",
        "interest_due",
        "penalty_interest_due",
        "principal_payment",
        "interest_payment",
        "penalty_payment",
        "write_off",
        "adjustment",
      ],
      loan_type: [
        "asset_finance",
        "unsecured",
        "mortgage",
        "overdraft",
        "shareholder",
        "other",
      ],
      logistics_billing_cycle: ["weekly", "biweekly", "monthly"],
      logistics_billing_mode: ["per_trip", "periodic"],
      logistics_carrier_type: ["internal", "subcontractor"],
      logistics_cost_category: [
        "fuel",
        "driver_allowance",
        "tolls",
        "parking",
        "repairs",
        "subcontractor",
        "loading",
        "permits",
        "other",
        "driver_salary",
        "mileage",
      ],
      logistics_order_status: [
        "draft",
        "confirmed",
        "assigned",
        "in_transit",
        "delivered",
        "invoiced",
        "cancelled",
      ],
      logistics_order_type: ["shuttle", "custom"],
      logistics_rate_type: ["per_trip", "per_km", "per_container"],
      logistics_trip_status: [
        "planned",
        "dispatched",
        "in_transit",
        "completed",
        "cancelled",
      ],
      logistics_vehicle_status: [
        "available",
        "on_trip",
        "maintenance",
        "retired",
      ],
      logistics_vehicle_type: ["truck", "trailer", "prime_mover"],
      material_movement_type: [
        "receipt",
        "issue",
        "return",
        "adjustment",
        "scrap",
      ],
      movement_type: [
        "gate_in",
        "gate_out",
        "reposition",
        "stack",
        "unstack",
        "repatriation",
      ],
      org_member_role: [
        "org_owner",
        "admin",
        "yard_operator",
        "gate_clerk",
        "viewer",
        "customer",
      ],
      org_member_status: ["invited", "active", "suspended"],
      org_status: [
        "trial",
        "active",
        "past_due",
        "suspended",
        "cancelled",
        "free",
      ],
      payment_method: [
        "bank_transfer",
        "cash",
        "cheque",
        "credit_card",
        "other",
      ],
      platform_invoice_line_type: ["base", "module", "seats", "adjustment"],
      platform_invoice_status: ["draft", "sent", "paid", "overdue", "void"],
      project_status: ["active", "on_hold", "completed", "archived"],
      repair_type: [
        "structural",
        "cosmetic",
        "mechanical",
        "electrical",
        "reefer",
      ],
      repatriation_status: [
        "pending",
        "approved",
        "dispatched",
        "completed",
        "cancelled",
      ],
      sale_status: ["listed", "reserved", "sold", "cancelled"],
      stock_adjustment_item_type: [
        "material",
        "finished_product",
        "sub_assembly",
      ],
      stock_adjustment_reason: [
        "damage",
        "loss",
        "theft",
        "found",
        "recount",
        "correction",
        "transfer",
        "other",
      ],
      stock_adjustment_type: [
        "count_variance",
        "write_off",
        "write_on",
        "reclassification",
      ],
      subscription_status: [
        "trial",
        "active",
        "past_due",
        "suspended",
        "cancelled",
      ],
      wo_priority: ["low", "medium", "high", "urgent"],
      wo_status: ["open", "in_progress", "on_hold", "completed", "cancelled"],
    },
  },
} as const
