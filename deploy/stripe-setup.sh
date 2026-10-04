#!/usr/bin/env bash
# Creates what RepoEasy needs in the Stripe account of the STRIPE_SECRET_KEY in /srv/repoeasy/.env:
# the Pro product with a monthly and a yearly price, the webhook endpoint and the customer portal
# settings. Writes the resulting ids and the webhook signing secret into that .env. Safe to run
# again: existing objects are kept. Runs on the server, so the secrets never leave it:
#
#   ssh wiestlab 'bash -s' < deploy/stripe-setup.sh
#   ssh wiestlab 'MONTHLY=150 YEARLY=1200 CURRENCY=eur bash -s' < deploy/stripe-setup.sh
#
# Afterwards restart the app:  docker compose -f app/deploy/compose.yml --project-directory . up -d --force-recreate
# Test and live mode are separate accounts in Stripe: switch the key in .env, clear
# STRIPE_WEBHOOK_SECRET, and run this again to go live.
set -euo pipefail

MONTHLY="${MONTHLY:-150}"   # smallest currency unit
YEARLY="${YEARLY:-1200}"
CURRENCY="${CURRENCY:-eur}"
# Managed Payments (Stripe as merchant of record) refuses products without an eligible tax code
TAX_CODE="${TAX_CODE:-txcd_10103001}" # Software as a service (SaaS) - business use

cd /srv/repoeasy
umask 077
KEY=$(grep '^STRIPE_SECRET_KEY=' .env | cut -d= -f2-)
BASE=$(grep '^BASE_URL=' .env | cut -d= -f2-)
[ -n "$KEY" ] && [ -n "$BASE" ] || { echo 'Set STRIPE_SECRET_KEY and BASE_URL in /srv/repoeasy/.env first.' >&2; exit 1; }
S=https://api.stripe.com/v1
api() { curl -sS -u "$KEY:" "$@"; }
get() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
ok() { python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit('Stripe: '+d['error'].get('message','error')) if 'error' in d else print(json.dumps(d))"; }
setenv() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi; }

lookup() { api -G "$S/prices" -d "lookup_keys[]=repoeasy_pro_monthly" -d "lookup_keys[]=repoeasy_pro_yearly"; }
if [ "$(lookup | get "len(d.get('data', []))")" = 0 ]; then
  prod=$(api "$S/products" -d name="RepoEasy Pro" -d tax_code="$TAX_CODE" -d "metadata[app]=repoeasy" \
    -d description="Unlimited tracked repositories, 100 followed repositories, sync every 6 hours, API tokens, webhook alerts, public share pages and badges." | ok | get "d['id']")
  api "$S/prices" -d product="$prod" -d currency="$CURRENCY" -d unit_amount="$MONTHLY" -d "recurring[interval]=month" -d lookup_key=repoeasy_pro_monthly -d nickname="Pro monthly" | ok >/dev/null
  api "$S/prices" -d product="$prod" -d currency="$CURRENCY" -d unit_amount="$YEARLY" -d "recurring[interval]=year" -d lookup_key=repoeasy_pro_yearly -d nickname="Pro yearly" | ok >/dev/null
fi
prices=$(lookup)
pm=$(echo "$prices" | get "[p['id'] for p in d['data'] if p['lookup_key']=='repoeasy_pro_monthly'][0]")
py=$(echo "$prices" | get "[p['id'] for p in d['data'] if p['lookup_key']=='repoeasy_pro_yearly'][0]")
prod=$(echo "$prices" | get "d['data'][0]['product']")

URL="$BASE/api/billing/webhook"
if ! grep -q '^STRIPE_WEBHOOK_SECRET=whsec_' .env; then
  # the signing secret is only shown at creation, so an endpoint without a stored secret is replaced
  for id in $(api "$S/webhook_endpoints?limit=100" | get "' '.join(w['id'] for w in d['data'] if w['url']=='$URL')"); do
    api -X DELETE "$S/webhook_endpoints/$id" >/dev/null
  done
  secret=$(api "$S/webhook_endpoints" -d url="$URL" -d description="RepoEasy plan changes" \
    -d "enabled_events[]=checkout.session.completed" -d "enabled_events[]=customer.subscription.created" \
    -d "enabled_events[]=customer.subscription.updated" -d "enabled_events[]=customer.subscription.deleted" | ok | get "d['secret']")
  setenv STRIPE_WEBHOOK_SECRET "$secret"
fi

if [ "$(api "$S/billing_portal/configurations?limit=1" | get "len(d.get('data', []))")" = 0 ]; then
  api "$S/billing_portal/configurations" -d "business_profile[headline]=RepoEasy" -d default_return_url="$BASE/settings" \
    -d "features[invoice_history][enabled]=true" -d "features[payment_method_update][enabled]=true" \
    -d "features[customer_update][enabled]=true" -d "features[customer_update][allowed_updates][]=email" \
    -d "features[customer_update][allowed_updates][]=address" -d "features[customer_update][allowed_updates][]=tax_id" \
    -d "features[subscription_cancel][enabled]=true" -d "features[subscription_cancel][mode]=at_period_end" \
    -d "features[subscription_update][enabled]=true" -d "features[subscription_update][default_allowed_updates][]=price" \
    -d "features[subscription_update][proration_behavior]=create_prorations" \
    -d "features[subscription_update][products][0][product]=$prod" \
    -d "features[subscription_update][products][0][prices][]=$pm" -d "features[subscription_update][products][0][prices][]=$py" | ok >/dev/null
fi

setenv STRIPE_PRICE_MONTHLY "$pm"
setenv STRIPE_PRICE_YEARLY "$py"

echo "product  $prod"
lookup | get "'\n'.join('price    %s  %s  %.2f %s / %s' % (p['id'], p['lookup_key'], p['unit_amount']/100, p['currency'], p['recurring']['interval']) for p in d['data'])"
api "$S/webhook_endpoints?limit=100" | get "'\n'.join('webhook  %s  %s  %s' % (w['id'], w['status'], w['url']) for w in d['data'])"
api "$S/billing_portal/configurations?limit=1" | get "'portal   %s  default=%s' % (d['data'][0]['id'], d['data'][0]['is_default'])"
echo "Set PRICE_DISPLAY_MONTHLY / PRICE_DISPLAY_YEARLY in .env to match, then restart the app."
