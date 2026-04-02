# Self-Hosted GitHub Actions Runner Setup (Friday)

This guide sets up a self-hosted GitHub Actions runner on the Friday lab server (`10.0.0.154`). Once registered, every push to `main` on `polecatspeaks/phantom` automatically deploys to Friday via `.github/workflows/deploy.yml`.

## Prerequisites

- SSH access to Friday as `chris` (`ssh phantom`)
- Admin access to the `polecatspeaks/phantom` GitHub repository (Settings > Actions > Runners)
- `sudo` access on the host for `systemctl restart phantom`

## Step 1: Add Sudoers Entry

The runner needs to restart the service without a password prompt. Add a sudoers rule:

```bash
ssh phantom "echo 'chris ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart phantom, /usr/bin/systemctl start phantom, /usr/bin/systemctl stop phantom' | sudo tee /etc/sudoers.d/phantom-runner"
ssh phantom "sudo chmod 440 /etc/sudoers.d/phantom-runner"
```

Verify it works:

```bash
ssh phantom "sudo systemctl status phantom --no-pager | head -3"
```

## Step 2: Get the Runner Registration Token

1. Go to `https://github.com/polecatspeaks/phantom/settings/actions/runners/new`
2. Select **Linux** and **x64**
3. Copy the `--token` value from the `./config.sh` command shown on the page

## Step 3: Install the Runner on Friday

```bash
ssh phantom "
mkdir -p ~/actions-runner && cd ~/actions-runner

# Download the latest runner (check https://github.com/actions/runner/releases for current version)
curl -fsSL https://github.com/actions/runner/releases/download/v2.323.0/actions-runner-linux-x64-2.323.0.tar.gz \
  -o runner.tar.gz
tar xzf runner.tar.gz
rm runner.tar.gz
"
```

## Step 4: Configure the Runner

Replace `<TOKEN>` with the token from Step 2:

```bash
ssh phantom "
cd ~/actions-runner
./config.sh \
  --url https://github.com/polecatspeaks/phantom \
  --token <TOKEN> \
  --name friday \
  --work /home/chris/runner-work \
  --labels self-hosted,linux,friday \
  --unattended
"
```

## Step 5: Install as a systemd Service

```bash
ssh phantom "
cd ~/actions-runner
sudo ./svc.sh install chris
sudo ./svc.sh start
sudo systemctl enable actions.runner.polecatspeaks-phantom.friday
"
```

Verify it's running:

```bash
ssh phantom "sudo systemctl status 'actions.runner.*' --no-pager"
```

The runner should appear as **Idle** on the GitHub Settings page within 30 seconds.

## Step 6: Test the Deploy Workflow

Trigger a manual deploy from GitHub to verify end-to-end:

1. Go to `Actions` tab on `polecatspeaks/phantom`
2. Select **Deploy to Friday**
3. Click **Run workflow** - leave `stop_after_deploy` unchecked
4. Watch the run - it should: pull, install, restart, health-check

Or from the command line (requires `gh` CLI):

```bash
gh workflow run deploy.yml --repo polecatspeaks/phantom
```

## Git Remote Cleanup

The Friday `/opt/phantom` checkout still has an `upstream` remote pointing at `ghostwright/phantom`. Since this fork is permanently diverged, remove it:

```bash
ssh phantom "cd /opt/phantom && git remote remove upstream && git remote -v"
```

Expected output: only `origin  https://github.com/polecatspeaks/phantom.git`

## Dev Workflow Scripts

Three helper scripts in `scripts/` wrap common SSH operations:

| Script | What it does |
|--------|-------------|
| `scripts/dev-start.sh` | Start service + wait for health OK |
| `scripts/dev-stop.sh` | Stop service |
| `scripts/dev-status.sh` | Show systemd status + health endpoint |

All three respect the `PHANTOM_HOST` env var (default: `phantom` from `~/.ssh/config`).

```bash
# Start for a dev session
./scripts/dev-start.sh

# Check status anytime
./scripts/dev-status.sh

# Stop when done to avoid idle cost
./scripts/dev-stop.sh
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Runner shows offline on GitHub | `ssh phantom "sudo systemctl restart actions.runner.*"` |
| Deploy fails at `systemctl restart` | Check sudoers entry in `/etc/sudoers.d/phantom-runner` |
| Health check fails after deploy | Check `ssh phantom "journalctl -u phantom -n 30 --no-pager"` |
| `git pull` fails with conflicts | Run `ssh phantom "cd /opt/phantom && git reset --hard origin/main"` |
