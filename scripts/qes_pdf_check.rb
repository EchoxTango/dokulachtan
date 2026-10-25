# frozen_string_literal: true

# E2E kontrola přímého podpisu PDF nativním tokem DocuSealu (docs/15 § 5):
# vypíše submission, pole `qes`, QES session a dokumenty, zkopíruje finální PDF
# a auditní stránku do /qes-out a změří inkoust v místě pečeti (Pdfium render).
require 'json'

submission = Submission.order(:id).last
raise 'žádná submission' if submission.nil?

submitter = submission.submitters.order(:id).last
session = QesSession.where(submitter_id: submitter.id).order(:id).last
field = Qes.template_fields(submission).find { |f| f['type'] == 'qes' }
area = field&.dig('areas', 0)

documents = Submissions::EnsureResultGenerated.call(submitter)
pdf = documents.first.download
audit = Submissions::EnsureAuditGenerated.call(submission)

if File.directory?('/qes-out')
  File.binwrite('/qes-out/qes-pdf-final.pdf', pdf)
  File.binwrite('/qes-out/qes-pdf-audit.pdf', audit.download) if audit
end

def ink_ratio(bytes, width, height, box)
  x0 = (box[0] * width).round
  x1 = (box[2] * width).round
  y0 = (box[1] * height).round
  y1 = (box[3] * height).round
  ink = 0

  (y0...y1).each do |py|
    (x0...x1).each do |px|
      blue, green, red = bytes.byteslice(((py * width) + px) * 4, 3).bytes

      ink += 1 if [blue, green, red].min < 250
    end
  end

  ink.to_f / ((y1 - y0) * (x1 - x0))
end

doc = Pdfium::Document.open_io(StringIO.new(pdf))
page = doc.get_page(area ? area['page'].to_i : 0)
bitmap, width, height = page.render_to_bitmap(width: 400)
page.close
doc.close

center_x = area ? area['x'].to_f + (area['w'].to_f / 2) : 0.5
center_y = area ? area['y'].to_f + (area['h'].to_f / 2) : 0.5

puts JSON.generate(
  {
    submission_id: submission.id,
    submission_completed: submission.completed_at.present?,
    submission_folder: submission.template&.folder_name,
    template_name: submission.template&.name,
    submitter_id: submitter.id,
    submitter_name: submitter.name,
    submitter_status: submitter.status,
    field_value: submitter.values[field&.dig('uuid')],
    field_area: area,
    session_id: session&.id,
    session_state: session&.state,
    session_level: session&.level,
    seal_state: session&.seal_state,
    validation: session&.validation_report,
    documents: documents.map { |a| a.filename.to_s },
    audit: audit&.filename&.to_s,
    stamp_ink: ink_ratio(bitmap, width, height,
                         [center_x - 0.05, center_y - 0.02, center_x + 0.05, center_y + 0.02]).round(4),
    other_ink: ink_ratio(bitmap, width, height, [0.05, 0.9, 0.35, 0.99]).round(4)
  }
)
