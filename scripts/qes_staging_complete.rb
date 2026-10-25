# frozen_string_literal: true

# Staging E2E dokončení (spouští se na stagingu přes `fly ssh console`):
# simuluje prohlížeč (hodnota `qes:<id>` přes Qes::ValueValidator),
# vygeneruje finální PDF a uloží ho na volume pro stažení.
#
# `QES_STAGING_SUBMITTER_SLUG` vybere submittera (u více signerů); bez něj
# se použije poslední submitter.
require 'json'

submitter_slug = ENV['QES_STAGING_SUBMITTER_SLUG'].presence
submitter =
  if submitter_slug
    Submitter.find_by!(slug: submitter_slug)
  else
    Submission.order(:id).last.submitters.order(:id).last
  end
submission = submitter.submission
session = QesSession.where(submitter_id: submitter.id).order(:id).last

if submitter.completed_at.blank?
  warden = Object.new
  def warden.user(*)
    nil
  end

  env = Rack::MockRequest.env_for("https://#{ENV.fetch('FLY_APP_NAME', 'dokulachtan')}.fly.dev/s/qes-staging",
                                  'HTTP_USER_AGENT' => 'qes-staging-e2e')
  env['warden'] = warden
  request = ActionDispatch::Request.new(env)
  params = ActionController::Parameters.new(
    values: { session.field_uuid => session.value_token }, completed: 'true'
  )

  Submitters::SubmitValues.call(submitter, params, request)
  submitter.reload
end

submission.reload

documents = Submissions::EnsureResultGenerated.call(submitter)
combined = submission.completed_at.present? ? Submissions::EnsureCombinedGenerated.call(submitter) : nil
audit = submission.completed_at.present? ? Submissions::EnsureAuditGenerated.call(submission) : nil

prefix = "/data/docuseal/qes-staging-#{submitter.slug}"
final = session.final_document.download if session.final_document.attached?
signed = session.signed_document.download if session.signed_document.attached?
File.binwrite("#{prefix}-final.pdf", final) if final
File.binwrite("#{prefix}-signed.pdf", signed) if signed

puts JSON.generate(
  {
    submitter: submitter.slug,
    submitter_completed: submitter.completed_at.present?,
    submission_completed: submission.completed_at.present?,
    documents: documents.map { |a| { name: a.name, filename: a.filename.to_s, byte_size: a.blob.byte_size } },
    combined: Array.wrap(combined).map { |a| { name: a.name, filename: a.filename.to_s, byte_size: a.blob.byte_size } },
    audit: Array.wrap(audit).map { |a| { name: a.name, filename: a.filename.to_s, byte_size: a.blob.byte_size } },
    final_file: final ? "#{prefix}-final.pdf" : nil,
    signed_file: signed ? "#{prefix}-signed.pdf" : nil,
    session: {
      id: session.id, state: session.state, level: session.level, seal_state: session.seal_state,
      document_digest: session.document_digest,
      signed_pdf_sha256: session.signed_pdf_sha256,
      final_pdf_sha256: session.final_pdf_sha256,
      value: submitter.values[session.field_uuid]
    }
  }
)
