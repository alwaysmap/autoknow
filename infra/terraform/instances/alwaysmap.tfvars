# AlwaysMap production instance. No secret VALUES here (those go to Secret Manager);
# these are deployment coordinates. One file like this per instance.
project_id            = "autoknow-prod-1895f1"
billing_account       = "01C8FA-971BEF-1D0F7E"
org_id                = "1043306095275"
region                = "us-central1"
allowed_domain        = "alwaysmap.com"
workspace_customer_id = "C03ln3mj4"
chat_group_owner      = "dylan@alwaysmap.com"
github_repo           = "alwaysmap/autoknow"

# Other Workspace domains whose users may also sign in. Sign-in only: they do not become
# the tenant (handles, groups and the Chat check stay on allowed_domain). Requires the
# OAuth consent screen to be External, a console step Terraform cannot do (OPERATIONS §3).
additional_signin_domains = ["google.com"]

# Custom domain. alwaysmap.com DNS stays in Squarespace's UI (dvhthomas@gmail.com);
# the autoknow → ghs.googlehosted.com CNAME is a manual record there.
custom_domain = "autoknow.alwaysmap.com"

# Ingestion drain alarm (issue #38). Activated for this instance; alerts go to the ops
# identity below. Change the recipient before applying if you want them elsewhere.
enable_ingestion_alarm = true
ingestion_alarm_email  = "dylan@alwaysmap.com"
