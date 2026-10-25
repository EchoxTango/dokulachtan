# frozen_string_literal: true

# Staging E2E bootstrap (spouští se na stagingu přes `fly ssh console` + rails runner):
# založí testovací šablonu s polem `qes`, submission a submittery.
# Vypíše JSON s slug submittera a uuid pole pro browser krok.
#
# `QES_STAGING_SIGNERS` (default 1) určuje počet signerů — každý má vlastní
# pole `qes` a podepisuje se striktně po sobě (SPEC § 4.6).
# `QES_STAGING_RESET=1` smaže předchozí testovací šablonu (čistý běh).
require 'base64'
require 'json'

PDF_BASE64 = 'JVBERi0xLjcKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNiAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggODEgPj4Kc3RyZWFtCkJUIC9GMSAxNCBUZiA3MiA3ODAgVGQgKERva3VsYWNodGFuIHRlc3QgZG9jdW1lbnQgLSBQREYgcHJvIEUyRSB0ZXN0eSBRRVMuKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzExIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDQyCiUlRU9GCg=='

account = Account.first
raise 'Staging nemá účet' if account.nil?

user = account.users.first
signer_count = ENV.fetch('QES_STAGING_SIGNERS', '1').to_i

if ENV['QES_STAGING_RESET'] == '1'
  account.templates.where(name: 'QES E2E (staging)').find_each(&:destroy!)
end

template = account.templates.find_by(name: 'QES E2E (staging)')

if template.nil?
  pdf = Base64.decode64(PDF_BASE64)
  template = account.templates.new(name: 'QES E2E (staging)', author: user, source: :api)
  attachment_uuid = SecureRandom.uuid

  template.submitters = Array.new(signer_count) do |index|
    { 'uuid' => SecureRandom.uuid, 'name' => "QES Signer #{index + 1}" }
  end
  template.preferences = { 'submitters_order' => 'preserved' } if signer_count > 1
  template.schema = [{ 'attachment_uuid' => attachment_uuid, 'name' => 'qes-staging' }]
  template.fields = template.submitters.each_with_index.map do |submitter, index|
    {
      'uuid' => SecureRandom.uuid, 'name' => "QES signature #{index + 1}", 'type' => 'qes',
      'required' => true, 'submitter_uuid' => submitter['uuid'],
      'preferences' => { 'level' => 'ades' },
      'areas' => [{ 'x' => 0.1, 'y' => 0.8 - (0.1 * index), 'w' => 0.3, 'h' => 0.06, 'page' => 0,
                    'attachment_uuid' => attachment_uuid }]
    }
  end
  template.save!
  template.documents_attachments.create!(
    uuid: attachment_uuid,
    blob: ActiveStorage::Blob.create_and_upload!(io: StringIO.new(pdf), filename: 'qes-staging.pdf')
  )
end

submission = template.submissions.order(:id).last
submission ||= template.submissions.create!(account: account, created_by_user: user,
                                           template_fields: template.fields,
                                           template_schema: template.schema,
                                           template_submitters: template.submitters)

submitters = template.submitters.map do |item|
  submitter = submission.submitters.find_by(uuid: item['uuid'])
  if submitter.nil?
    submitter = submission.submitters.create!(account: account, uuid: item['uuid'],
                                             name: item['name'], email: "#{item['uuid'][0, 8]}@example.com")
  end
  field = template.fields.find { |f| f['submitter_uuid'] == item['uuid'] }

  { slug: submitter.slug, field_uuid: field['uuid'], name: submitter.name }
end

puts JSON.generate(
  {
    submission_id: submission.id,
    submitters: submitters,
    submitter_slug: submitters.first[:slug],
    field_uuid: submitters.first[:field_uuid],
    base_url: "https://#{ENV.fetch('FLY_APP_NAME', 'dokulachtan-staging')}.fly.dev"
  }
)
