FROM nginx:alpine

COPY dokulachtan-signer.apk /usr/share/nginx/html/dokulachtan-signer.apk
COPY index.html /usr/share/nginx/html/index.html

# Soubory v kontextu mají restriktivní práva (0660) — nginx je čte jako user nginx
RUN chmod 644 /usr/share/nginx/html/*

# APK se musí stahovat jako soubor (conf.d je includován v http bloku)
RUN printf 'types {\n    application/vnd.android.package-archive apk;\n}\n' \
    > /etc/nginx/conf.d/apk-types.conf
