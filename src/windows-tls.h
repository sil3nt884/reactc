/* Add the Windows root store to OpenSSL's normal trust configuration. */
#include <wincrypt.h>
#undef X509_NAME
#undef X509_EXTENSIONS
#undef PKCS7_SIGNER_INFO
#undef OCSP_REQUEST
#undef OCSP_RESPONSE

static void porf_win_tls_roots(X509_STORE *store) {
  HCERTSTORE roots = CertOpenSystemStoreW(0, L"ROOT");
  if (!roots) return;
  PCCERT_CONTEXT entry = NULL;
  while ((entry = CertEnumCertificatesInStore(roots, entry)) != NULL) {
    const unsigned char *der = entry->pbCertEncoded;
    X509 *certificate = d2i_X509(NULL, &der, entry->cbCertEncoded);
    if (certificate) {
      X509_STORE_add_cert(store, certificate);
      X509_free(certificate);
    }
  }
  CertCloseStore(roots, 0);
}
