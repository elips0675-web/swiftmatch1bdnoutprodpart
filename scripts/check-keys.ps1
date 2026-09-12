param([switch]$Fix)

$envPath = Join-Path $PSScriptRoot "..\server\.env"
if (!(Test-Path $envPath)) { Write-Host "server/.env not found!" -ForegroundColor Red; exit 1 }

$content = Get-Content $envPath
$errors = @()

$checks = @(
  @{Key="STRIPE_SECRET_KEY"; Name="Stripe LIVE"; Doc="https://dashboard.stripe.com/apikeys"},
  @{Key="STRIPE_WEBHOOK_SECRET"; Name="Stripe Webhook"; Doc="https://dashboard.stripe.com/webhooks"},
  @{Key="SMTP_HOST"; Name="SMTP host"; Doc="smtp.gmail.com / SendGrid / Resend"},
  @{Key="SMTP_USER"; Name="SMTP username"; Doc="SendGrid/Resend/SES"},
  @{Key="SMTP_PASS"; Name="SMTP password"; Doc="SendGrid/Resend/SES"},
  @{Key="FCM_SERVER_KEY"; Name="Firebase FCM"; Doc="https://console.firebase.google.com -> Project settings -> Cloud Messaging"},
  @{Key="REVENUECAT_WEBHOOK_SECRET"; Name="RevenueCat"; Doc="https://app.revenuecat.com -> Settings -> Webhooks"},
  @{Key="TWILIO_ACCOUNT_SID"; Name="Twilio SID"; Doc="https://console.twilio.com"},
  @{Key="TWILIO_AUTH_TOKEN"; Name="Twilio Token"; Doc="https://console.twilio.com"},
  @{Key="TWILIO_PHONE_NUMBER"; Name="Twilio Phone"; Doc="https://console.twilio.com -> Phone Numbers"},
  @{Key="OPENAI_API_KEY"; Name="OpenAI"; Doc="https://platform.openai.com/api-keys"},
  @{Key="SENTRY_DSN"; Name="Sentry"; Doc="https://sentry.io/settings/projects"},
  @{Key="AWS_ACCESS_KEY_ID"; Name="AWS Access Key"; Doc="https://console.aws.amazon.com/iam"},
  @{Key="AWS_SECRET_ACCESS_KEY"; Name="AWS Secret"; Doc="https://console.aws.amazon.com/iam"},
  @{Key="S3_BUCKET"; Name="S3 Bucket"; Doc="https://console.aws.amazon.com/s3"},
  @{Key="FCM_SERVICE_ACCOUNT"; Name="FCM Service Account"; Doc="Firebase console -> Service accounts -> Generate new private key"},
  @{Key="REDIS_URL"; Name="Redis URL"; Doc="Upstash / Redis Labs / localhost"},
  @{Key="JWT_SECRET"; Name="JWT Secret"; Doc="!REQUIRED! Used for auth tokens"}
)

$optional = @("SENTRY_DSN", "REDIS_URL", "AWS_ACCESS_KEY_ID", "S3_BUCKET", "OPENAI_API_KEY", "FCM_SERVICE_ACCOUNT", "SMTP_HOST")

Write-Host "`n=== SwiftMatch Key Check ===`n" -ForegroundColor Cyan
$allOk = $true
$emptyKeys = @()
$commentedKeys = @()

foreach ($check in $checks) {
  $key = $check.Key
  $name = $check.Name
  $doc = $check.Doc

  $line = $content | Where-Object { $_ -match "^$key=" -or $_ -match "^#\s*$key=" }
  if (!$line) {
    $errors += "$key - NOT FOUND in .env"
    Write-Host "  $key`t($name)`t[NOT FOUND]" -ForegroundColor Red
    $allOk = $false
    continue
  }

  if ($line -match "^#") {
    $val = ($line -replace "^#\s*$key=", "").Trim()
    if (!$val -or $val -eq "xxx" -or $val -eq "" -or $val -like "sk_live_..." -or $val -like "ACxxx") {
      if ($key -in $optional) {
        Write-Host "  $key`t($name)`t[OPTIONAL / commented]" -ForegroundColor DarkYellow
      } else {
        Write-Host "  $key`t($name)`t[EMPTY / commented]" -ForegroundColor Yellow
        $emptyKeys += $key
      }
    } else {
      Write-Host "  $key`t($name)`t[COMMENTED but has value]" -ForegroundColor Magenta
    }
  } else {
    $val = ($line -replace "^$key=", "").Trim()
    if (!$val -or $val -eq "" -or $val -like "sk_live_..." -or $val -like "ACxxx" -or $val -like "AAAAxxx") {
      Write-Host "  $key`t($name)`t[EMPTY]" -ForegroundColor Yellow
      $emptyKeys += $key
    } else {
      Write-Host "  $key`t($name)`t[OK]" -ForegroundColor Green
    }
  }
}

Write-Host "`n=== Missing Keys ===" -ForegroundColor Cyan
if ($emptyKeys.Count -eq 0) {
  Write-Host "  All required keys are set!" -ForegroundColor Green
} else {
  foreach ($key in $emptyKeys) {
    $check = $checks | Where-Object { $_['Key'] -eq $key }
    Write-Host "  [X] $key - $($check.Name)" -ForegroundColor Yellow
    Write-Host "     Get it: $($check.Doc)" -ForegroundColor DarkGray
  }
  Write-Host "`nTotal: $($emptyKeys.Count) keys need attention" -ForegroundColor Yellow
}

Write-Host "`n=== Quick Start for Each Service ===" -ForegroundColor Cyan
Write-Host @"

1. Firebase (FCM): console.firebase.google.com -> Create project -> Cloud Messaging -> Server key
2. RevenueCat: app.revenuecat.com -> Create project -> Add products (plus_1m/6m/12m, gold_*, platinum_* — соответствуют src/lib/iap.ts productIdFor)
3. Twilio: console.twilio.com -> Buy phone number -> Account SID + Auth Token
4. Stripe: dashboard.stripe.com/apikeys -> Create live keys
5. SMTP: app.sendgrid.com -> SMTP settings -> Create API key
6. Sentry: sentry.io -> Create project -> DSN
7. AWS: console.aws.amazon.com -> IAM -> Create user with S3 + Rekognition permissions
8. Redis: upstash.com -> Create redis -> URL
9. OpenAI: platform.openai.com/api-keys -> Create key

"@