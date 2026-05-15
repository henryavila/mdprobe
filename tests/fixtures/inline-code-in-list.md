# Onda 3 — Plano Faseado

## Sessão 1: Foundation

### Tarefas

1. **Revert Geadf Resource entregue hoje**:
   - Delete `app/Filament/Panels/AreaNotifications/Resources/GeadfNotificationTemplates/`
   - Delete factories de Template criadas hoje

2. **Migrations (6 tabelas novas)**:
   - `area_notification_configs` (config + flags + custom_tags_definitions JSON + escape hatch)
   - `area_notification_templates` (unificada: id, area_id, name, subject, text, purpose, target_audience)
   - `area_notifications` (core: id, area_id, template_id, user_id, number, subject, registro)
   - `area_notification_geadf_data` (extensão área: provider_name, vigencia_*, fiscal_*, gestor_*)
   - `area_notification_gereg_data` (extensão área: situation_id, reason, is_oficio)
   - `area_notification_deadlines` (extensão cross-área: acknowledgment_of_receipt, extended_date, marked_as_overdue, resolved_at)

3. **Models**:
   - `AreaNotificationConfig` (1:1 com Area)
   - `AreaNotificationTemplate` (unificada)
