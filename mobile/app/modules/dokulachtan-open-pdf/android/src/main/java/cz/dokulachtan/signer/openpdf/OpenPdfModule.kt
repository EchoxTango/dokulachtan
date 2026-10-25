package cz.dokulachtan.signer.openpdf

import android.content.ContentResolver
import android.content.Intent
import androidx.core.content.FileProvider
import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID

/**
 * Přijme `ACTION_VIEW` s `application/pdf` (otevření PDF z jiné aplikace),
 * zkopíruje obsah do cache a předá ho JS. Na rozdíl od share sheetu
 * (`ACTION_SEND`) tady dostáváme původní soubor, ne re-export z editoru.
 */
class OpenPdfModule : Module() {
  companion object {
    private var instance: OpenPdfModule? = null
    private var pending: Map<String, String?>? = null
  }

  override fun definition() = ModuleDefinition {
    Name("DokulachtanOpenPdf")

    Events("onOpenPdf")

    OnCreate {
      instance = this@OpenPdfModule
      pending = extract(appContext.currentActivity?.intent)
    }

    OnNewIntent { intent ->
      val value = extract(intent)

      if (value != null) {
        pending = value
        instance?.sendEvent("onOpenPdf", value)
      }
    }

    AsyncFunction("consumeOpenPdf") {
      // OnCreate může proběhnout dřív, než je activity dostupná; proto
      // fallback na aktuální intent i při prvním volání z JS.
      val value = pending ?: extract(appContext.currentActivity?.intent)

      pending = null
      value
    }

    // Share sheet (`expo-share-intent`) někdy předá prázdnou cache kopii;
    // `contentUri` je původní soubor od zdrojové aplikace. Zkopírujeme ho
    // stejnou cestou jako open intent a vrátíme `file://` URI pro JS.
    AsyncFunction("copyPdf") { uri: String, name: String ->
      val file = copyToCache(Uri.parse(uri), name) ?: return@AsyncFunction null

      mapOf(
        "uri" to Uri.fromFile(file).toString(),
        "name" to name,
        "type" to "application/pdf"
      )
    }

    AsyncFunction("openPdf") { uri: String ->
      val context = appContext.reactContext ?: error("pdf_viewer_unavailable")
      val file = File(Uri.parse(uri).path ?: error("invalid_pdf")).canonicalFile
      val directory = File(context.cacheDir, "reviewed-pdf").canonicalFile
      require(file.parentFile == directory && file.isFile) { "invalid_pdf" }
      val contentUri = FileProvider.getUriForFile(context, "${context.packageName}.reviewedpdf", file)
      val view = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(contentUri, "application/pdf")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      // Vlastní import PDF nesmí být nabízen jako prohlížeč.
      val viewers = context.packageManager.queryIntentActivities(view, 0)
        .filter { it.activityInfo.packageName != context.packageName }
        .map { info -> Intent(view).setClassName(info.activityInfo.packageName, info.activityInfo.name) }
      check(viewers.isNotEmpty()) { "pdf_viewer_unavailable" }
      val chooser = Intent.createChooser(viewers.first(), "Otevřít dokument ke kontrole").apply {
        putExtra(Intent.EXTRA_INITIAL_INTENTS, viewers.drop(1).toTypedArray())
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(chooser)
    }

    OnDestroy {
      instance = null
    }
  }

  private fun extract(intent: Intent?): Map<String, String?>? {
    if (intent?.action != Intent.ACTION_VIEW) {
      return null
    }

    val uri = intent.data ?: return null
    val resolver = appContext.reactContext?.contentResolver ?: return null
    val mimeType = intent.type ?: resolver.getType(uri)
    val name = queryName(resolver, uri) ?: uri.lastPathSegment ?: "document.pdf"

    if (mimeType != "application/pdf" && !name.endsWith(".pdf", ignoreCase = true)) {
      return null
    }

    val file = copyToCache(uri, name) ?: return null

    return mapOf(
      "uri" to Uri.fromFile(file).toString(),
      "name" to name,
      "type" to "application/pdf"
    )
  }

  private fun queryName(resolver: ContentResolver, uri: Uri): String? {
    return try {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun copyToCache(uri: Uri, name: String): File? {
    return try {
      val context = appContext.reactContext ?: return null
      val directory = File(context.cacheDir, "opened-pdf").apply { mkdirs() }
      val safeName = name.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank { "document.pdf" }
      val target = File(directory, "${UUID.randomUUID()}-$safeName")
      val input = if (uri.scheme == "file") {
        File(uri.path ?: return null).inputStream()
      } else {
        context.contentResolver.openInputStream(uri) ?: return null
      }

      input.use { source ->
        target.outputStream().use { sink -> source.copyTo(sink) }
      }

      target
    } catch (_: Exception) {
      null
    }
  }
}
