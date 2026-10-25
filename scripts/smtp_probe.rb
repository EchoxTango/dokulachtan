# frozen_string_literal: true

# Testovací e-mail pro ověření SMTP v běžící appce (make smtp-test APP=… TO=…).
#
# Dědí z ApplicationMailer, takže projde stejnou cestou jako pozvánky od DocuSealu:
# interceptor přepíše From na SMTP_FROM a odešle se přes SMTP z ENV.
# Předmět obsahuje název appky, aby se dalo rozlišit staging od produkce.

class SmtpProbeMailer < ApplicationMailer
  def probe(to, tag)
    mail(to: to, from: to, subject: "DocuSeal SMTP test [#{tag}]") do |format|
      format.text do
        render plain: "SMTP test from #{tag} at #{Time.now.utc} via #{ENV.fetch('SMTP_ADDRESS')}."
      end
    end
  end
end

raise 'SMTP_ADDRESS not set' if ENV['SMTP_ADDRESS'].to_s.empty?
raise 'SMTP_FROM missing' unless ENV['SMTP_FROM'].to_s.match?(User::FULL_EMAIL_REGEXP)

SmtpProbeMailer.probe(ENV.fetch('SMTP_PROBE_TO'), ENV.fetch('SMTP_PROBE_TAG')).deliver_now!
puts "SMTP test sent [#{ENV.fetch('SMTP_PROBE_TAG')}] to #{ENV.fetch('SMTP_PROBE_TO')}"
