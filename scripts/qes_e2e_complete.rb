# frozen_string_literal: true

# E2E dokončení (spouští se uvnitř kontejneru přes `rails runner`):
# simuluje prohlížeč — odešle formulář s hodnotou `qes:<id>` (projde
# `Qes::ValueValidator`), vygeneruje finální PDF a zkopíruje je do /qes-out.
#
# `QES_E2E_SUBMITTER_SLUG` vybere submittera (u více signerů); bez něj
# se použije poslední submitter.
require 'json'

submitter_slug = ENV['QES_E2E_SUBMITTER_SLUG'].presence
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

  env = Rack::MockRequest.env_for('http://127.0.0.1:3030/s/qes-e2e',
                                  'HTTP_USER_AGENT' => 'qes-e2e')
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

documents.each { |attachment| File.binwrite("/qes-out/#{attachment.filename}", attachment.download) }
Array.wrap(combined).each { |attachment| File.binwrite("/qes-out/#{attachment.filename}", attachment.download) }
Array.wrap(audit).each { |attachment| File.binwrite("/qes-out/#{attachment.filename}", attachment.download) }

signed = session.signed_document.download if session.signed_document.attached?
final = session.final_document.download if session.final_document.attached?
File.binwrite("/qes-out/qes-signed.pdf", signed) if signed
File.binwrite("/qes-out/qes-final.pdf", final) if final

puts JSON.generate(
  {
    submitter: submitter.slug,
    submitter_completed: submitter.completed_at.present?,
    submission_completed: submission.completed_at.present?,
    documents: documents.map { |a| { name: a.name, filename: a.filename.to_s, byte_size: a.blob.byte_size } },
    combined: Array.wrap(combined).map { |a| { name: a.name, filename: a.filename.to_s, byte_size: a.blob.byte_size } },
    audit: Array.wrap(audit).map { |a| { name: a.name, filename: a.filename.to_s, byte_size: a.blob.byte_size } },
    session: {
      id: session.id,
      state: session.state,
      level: session.level,
      seal_state: session.seal_state,
      document_digest: session.document_digest,
      signed_pdf_sha256: session.signed_pdf_sha256,
      final_pdf_sha256: session.final_pdf_sha256,
      value: submitter.values[session.field_uuid]
    }
  }
)
