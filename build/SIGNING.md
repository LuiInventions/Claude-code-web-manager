# Code signing — removing the "Unknown publisher" warning

The Windows **SmartScreen** / **UAC** *"Unknown publisher"* warning is shown for
**any** executable that is not signed with a certificate issued by a real
**Certificate Authority (CA)**. Setting a publisher name in the build metadata
(which we do — `LT Digital Concepts`, see `electron-builder.yml`) makes the name
appear in the file's **Details** tab, but does **not** remove the warning on its
own. Removing it requires a CA-issued **code-signing certificate** tied to your
identity / business (the LT Digital Concepts Gewerbe).

The signing pipeline is already wired: with the right environment present,
`npm run electron:build` (and the GitHub Actions release workflow) sign the
installer automatically. With nothing set, the build is **unsigned** but still
carries the publisher metadata. Pick one of the routes below when you're ready.

> Publisher name on the build: `LT Digital Concepts` · Copyright:
> `© 2026 LT Digital Concepts (Luis Kleemann)`.

---

## Option A — Azure Trusted Signing (cheapest legitimate route, ~$10/mo)

Establishes a verified publisher identity and needs no hardware token — the
standard modern route to clear the SmartScreen prompt. Note that SmartScreen
reputation is ultimately governed by Microsoft and the exact timing can vary
(it is not always instant); a freshly signed app may still warn briefly until
reputation accrues.

1. Create an Azure account and enable **Trusted Signing**.
2. Complete **identity validation**. As a new sole proprietor, use the
   **Individual** validation type — the certificate is issued to
   `Luis Kleemann`. (Organization validation needs 3+ years of verifiable
   business history, which a fresh Gewerbe doesn't have yet.)
3. Note the endpoint, the **account** name, and the **certificate profile** name.
4. Add an `azureSignOptions` block under `win:` in `electron-builder.yml`:

   ```yaml
   win:
     publisherName: LT Digital Concepts
     azureSignOptions:
       endpoint: https://eus.codesigning.azure.net
       certificateProfileName: <your-profile>
       codeSigningAccountName: <your-account>
   ```

5. Provide the service-principal credentials as environment variables
   (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`) — locally in
   your shell, or as **GitHub Actions repo secrets** for the release workflow.

## Option B — Buy an OV or EV certificate (~€200–400/yr)

From Sectigo, DigiCert, GlobalSign, etc.

- **EV** certificate → strongest publisher trust (ships on a hardware token /
  cloud HSM); historically cleared SmartScreen fastest, but Microsoft's
  SmartScreen behaviour and timing have changed over time, so treat "instant" as
  best-case, not guaranteed.
- **OV** certificate → cheaper, but SmartScreen only stops warning **after the
  file builds up download reputation**.

Then sign via the standard electron-builder env vars (no YAML change needed):

```powershell
$env:CSC_LINK = "C:\path\to\certificate.pfx"   # or a base64 string of the .pfx
$env:CSC_KEY_PASSWORD = "<pfx password>"
npm run electron:build
```

In CI, store these as the repo secrets `CSC_LINK` (base64 of the `.pfx`) and
`CSC_KEY_PASSWORD` — the release workflow already passes them through when set.

## Option C — Self-signed (free, does NOT remove the warning)

A self-signed certificate puts the publisher name into the signature, but
SmartScreen/UAC **keep warning** for anyone who downloads the app unless they
manually import your certificate into their **Trusted Root** store. Useful only
for testing the signing pipeline, not for distribution.

```powershell
# create a self-signed code-signing cert for the company
$cert = New-SelfSignedCertificate -Type CodeSigningCert `
  -Subject "CN=LT Digital Concepts" -CertStoreLocation Cert:\CurrentUser\My
$pwd = ConvertTo-SecureString -String "test" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath ltdc.pfx -Password $pwd
$env:CSC_LINK = "ltdc.pfx"; $env:CSC_KEY_PASSWORD = "test"
npm run electron:build
```

---

## How signing plugs into the build

- **Local:** `npm run electron:build` → electron-builder reads `CSC_LINK` /
  `CSC_KEY_PASSWORD` (or `azureSignOptions`) from the environment and signs the
  NSIS installer + portable exe. No env → unsigned.
- **CI:** `.github/workflows/release.yml` builds on a Windows runner when a
  `v*` tag is pushed and forwards the same secrets to electron-builder, then
  publishes the `cc-control-center-*` artifacts to the GitHub Release.
