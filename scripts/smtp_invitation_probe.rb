# frozen_string_literal: true

# Ověření reálné pozvánky (make smtp-invite-test APP=… TO=…).
#
# Na běžící appce vytvoří submission s podepisujícím na zadaný e-mail a spustí
# stejný job, jaký posílá pozvánky v provozu (SendSubmitterInvitationEmailJob,
# tedy SubmitterMailer.invitation_email + interceptor + SMTP z ENV). Na rozdíl od
# smtp_probe.rb tak ověří i cestu pozvánek včetně odkazu na podpis.
#
# Vyžaduje existující účet a šablonu (na stagingu ji vytváří `make qes-staging-e2e`,
# název lze přepsat přes SMTP_INVITE_TEMPLATE).

require 'json'

to = ENV.fetch('SMTP_INVITE_TO')
template_name = ENV.fetch('SMTP_INVITE_TEMPLATE', 'QES E2E (staging)')

account = Account.first
raise 'app nemá účet (proběhl setup?)' if account.nil?

user = account.users.first
template = account.templates.find_by(name: template_name)
raise "šablona #{template_name.inspect} nenalezena" if template.nil?

submission = template.submissions.create!(
  account: account,
  created_by_user: user,
  template_fields: template.fields,
  template_schema: template.schema,
  template_submitters: template.submitters
)

submitter = submission.submitters.create!(
  account: account,
  uuid: template.submitters.first['uuid'],
  name: 'SMTP invitation test',
  email: to
)

SendSubmitterInvitationEmailJob.new.perform('submitter_id' => submitter.id)

puts JSON.generate(
  {
    submission_id: submission.id,
    submitter_id: submitter.id,
    sent_at: submitter.reload.sent_at,
    signing_url: "https://#{ENV.fetch('FLY_APP_NAME')}.fly.dev/s/#{submitter.slug}"
  }
)
