# frozen_string_literal: true

# E2E bootstrap (spouští se uvnitř kontejneru přes `rails runner`):
# založí účet, API token, šablonu s polem `qes`, submission a submittery.
# Vypíše JSON s tím, co potřebuje Python simulace appky.
#
# `QES_E2E_SIGNERS` (default 1) určuje počet signerů — každý má vlastní pole
# `qes` a podepisuje se striktně po sobě (SPEC § 4.6).
require 'base64'
require 'json'

account = Account.first || Account.create!(name: 'QES E2E', timezone: 'UTC', locale: 'en')

user = account.users.first
if user.nil?
  user = account.users.create!(first_name: 'QES', last_name: 'E2E',
                              email: 'qes-e2e@example.com', password: 'password123')
  user.confirm if user.respond_to?(:confirm)
  user.save!
end

if account.encrypted_configs.find_by(key: EncryptedConfig::APP_URL_KEY).nil?
  account.encrypted_configs.create!(key: EncryptedConfig::APP_URL_KEY, value: 'http://127.0.0.1:3000')
end

if account.encrypted_configs.find_by(key: EncryptedConfig::ESIGN_CERTS_KEY).nil?
  account.encrypted_configs.create!(key: EncryptedConfig::ESIGN_CERTS_KEY,
                                   value: GenerateCertificate.call.transform_values(&:to_pem))
end

token = (user.access_tokens.first || user.access_tokens.create!).token
signer_count = ENV.fetch('QES_E2E_SIGNERS', '1').to_i

template = account.templates.find_by(name: 'QES E2E')
if template.nil?
  pdf = File.binread(ENV.fetch('QES_E2E_PDF'))
  template = account.templates.new(name: 'QES E2E', author: user, source: :api)
  uuid = SecureRandom.uuid

  template.submitters = Array.new(signer_count) do |index|
    { 'uuid' => SecureRandom.uuid, 'name' => "Signer #{index + 1}" }
  end
  template.preferences = { 'submitters_order' => 'preserved' } if signer_count > 1
  template.schema = [{ 'attachment_uuid' => uuid, 'name' => 'qes-e2e-document' }]
  template.fields = template.submitters.each_with_index.map do |submitter, index|
    {
      'uuid' => SecureRandom.uuid, 'name' => "QES signature #{index + 1}", 'type' => 'qes',
      'required' => true, 'submitter_uuid' => submitter['uuid'],
      'preferences' => { 'level' => ENV.fetch('QES_E2E_LEVEL', 'ades') },
      'areas' => [{ 'x' => 0.1, 'y' => 0.8 - (0.1 * index), 'w' => 0.3, 'h' => 0.06, 'page' => 0,
                    'attachment_uuid' => uuid }]
    }
  end
  template.save!
  template.documents_attachments.create!(
    uuid: uuid,
    blob: ActiveStorage::Blob.create_and_upload!(io: StringIO.new(pdf), filename: 'qes-e2e.pdf')
  )
end

submission = template.submissions.order(:id).last
if submission.nil?
  submission = template.submissions.create!(account: account, created_by_user: user,
                                          template_fields: template.fields,
                                          template_schema: template.schema,
                                          template_submitters: template.submitters)
end

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
    token: token,
    template_id: template.id,
    submission_id: submission.id,
    submitters: submitters,
    submitter_slug: submitters.first[:slug],
    field_uuid: submitters.first[:field_uuid]
  }
)
