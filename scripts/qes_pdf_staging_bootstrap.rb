# frozen_string_literal: true

# Staging bootstrap přímého podpisu PDF (docs/15 § 9), spouští se přes
# `fly ssh console` + rails runner: vytvoří API token účtu (`X-Auth-Token`)
# pro upload PDF. `QES_PDF_STAGING_CLEANUP=1` token zase smaže.
require 'json'

account = Account.first
raise 'Staging nemá účet' if account.nil?

user = account.users.first
raise 'Staging nemá uživatele' if user.nil?

if ENV['QES_PDF_STAGING_CLEANUP'] == '1'
  token = ENV.fetch('QES_PDF_STAGING_TOKEN', '')
  deleted = AccessToken.where(sha256: Digest::SHA256.hexdigest(token)).delete_all

  puts JSON.generate({ mode: 'cleanup', deleted: })
else
  token = SecureRandom.base58(AccessToken::TOKEN_LENGTH)
  user.access_tokens.create!(token:)

  puts JSON.generate({ token:, account_id: account.id, email: user.email })
end
