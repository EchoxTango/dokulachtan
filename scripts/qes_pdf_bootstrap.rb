# frozen_string_literal: true

# E2E bootstrap přímého podpisu PDF (docs/15 § 9): založí účet a vypíše API
# token pro appku (upload tokenem, `X-Auth-Token`).
require 'json'

account = Account.first || Account.create!(name: 'QES PDF E2E', timezone: 'UTC', locale: 'en')

user = account.users.first
if user.nil?
  user = account.users.create!(first_name: 'QES', last_name: 'PDF E2E',
                              email: 'qes-pdf-e2e@example.com', password: 'password123')
  user.confirm if user.respond_to?(:confirm)
  user.save!
end

if account.encrypted_configs.find_by(key: EncryptedConfig::APP_URL_KEY).nil?
  account.encrypted_configs.create!(key: EncryptedConfig::APP_URL_KEY, value: 'http://127.0.0.1:3030')
end

if account.encrypted_configs.find_by(key: EncryptedConfig::ESIGN_CERTS_KEY).nil?
  account.encrypted_configs.create!(key: EncryptedConfig::ESIGN_CERTS_KEY,
                                   value: GenerateCertificate.call.transform_values(&:to_pem))
end

token = (user.access_tokens.first || user.access_tokens.create!).token

puts JSON.generate({ token:, account_id: account.id })
