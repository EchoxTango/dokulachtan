package cz.dokulachtan.signerpoc;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.cert.Certificate;

/**
 * PoC podpisového klienta pro variantu B: klíč z PKCS#12 zůstane v telefonu,
 * podepíše se pouze digest (DigestInfo) a výsledná raw signatura se vrátí serveru.
 *
 * Vstupy/výstupy přes /data/local/tmp (push/pull přes adb).
 */
public class MainActivity extends Activity {

    private static final String TAG = "SignerPoC";
    private static final String PASS = "test";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String dir = getFilesDir().getAbsolutePath() + "/";
        String p12 = dir + "signer.p12";
        String in = dir + "digest.bin";
        String out = dir + "signature.bin";
        String certOut = dir + "cert.der";
        try {
            KeyStore ks = KeyStore.getInstance("PKCS12");
            try (FileInputStream fis = new FileInputStream(p12)) {
                ks.load(fis, PASS.toCharArray());
            }

            String alias = ks.aliases().nextElement();
            PrivateKey key = (PrivateKey) ks.getKey(alias, PASS.toCharArray());
            Certificate cert = ks.getCertificate(alias);

            byte[] digestInfo = readAll(in);

            Signature sig = Signature.getInstance("NONEwithRSA");
            sig.initSign(key);
            sig.update(digestInfo);
            byte[] signature = sig.sign();

            writeAll(out, signature);
            writeAll(certOut, cert.getEncoded());

            Log.i(TAG, "OK alias=" + alias
                    + " subject=" + ((java.security.cert.X509Certificate) cert).getSubjectX500Principal().getName()
                    + " digestInfoBytes=" + digestInfo.length
                    + " signatureBytes=" + signature.length);
        } catch (Exception e) {
            Log.e(TAG, "ERROR", e);
        }
        finish();
    }

    private static byte[] readAll(String path) throws Exception {
        File f = new File(path);
        byte[] buf = new byte[(int) f.length()];
        try (FileInputStream in = new FileInputStream(f)) {
            int off = 0;
            while (off < buf.length) {
                int n = in.read(buf, off, buf.length - off);
                if (n < 0) break;
                off += n;
            }
        }
        return buf;
    }

    private static void writeAll(String path, byte[] data) throws Exception {
        try (FileOutputStream out = new FileOutputStream(path)) {
            out.write(data);
        }
    }
}
