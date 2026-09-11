#!/usr/bin/env bash
#
# Creates the AWS side of the shop's server: a key pair, a firewall, an instance, and an address
# that never changes. Everything it makes is tagged `shridhar-billing` so it can be found again,
# and it is safe to run twice -- each piece is reused if it already exists.
#
#   bash deploy/provision.sh
#
# Needs the AWS CLI configured with a key that can use EC2. It deliberately does not touch
# MongoDB Atlas, the DNS name, or anything holding a secret; those come after.

set -euo pipefail

AWS="${AWS:-/c/Program Files/Amazon/AWSCLIV2/aws.exe}"
command -v "$AWS" >/dev/null 2>&1 || [ -x "$AWS" ] || AWS="aws"

NAME="${NAME:-shridhar-billing}"
REGION="${REGION:-ap-south-1}"          # Mumbai: the closest region to Karnataka.
TYPE="${TYPE:-t3.micro}"                # Free for twelve months on a new account.
KEY_FILE="${KEY_FILE:-$HOME/.ssh/$NAME.pem}"

aws_() { "$AWS" --region "$REGION" --output json "$@"; }
say() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
die() { printf '\n\033[1;31mxx\033[0m %s\n\n' "$1" >&2; exit 1; }

say "Checking the credentials"
WHO="$(aws_ sts get-caller-identity --output text --query 'Arn' 2>&1)" \
  || die "The AWS CLI is not configured. Run 'aws configure' first."
echo "    $WHO"
case "$WHO" in
  *":root") echo "    Note: this is the root account. An IAM user would be safer." ;;
esac

# ---------------------------------------------------------------- the key to get in with

say "Key pair"
if aws_ ec2 describe-key-pairs --key-names "$NAME" >/dev/null 2>&1; then
  echo "    $NAME already exists."
  [ -f "$KEY_FILE" ] || die "AWS has a key pair called $NAME but $KEY_FILE is missing. Either
    put the original .pem there, or delete the key pair in EC2 and run this again."
else
  mkdir -p "$(dirname "$KEY_FILE")"
  aws_ ec2 create-key-pair --key-name "$NAME" --query 'KeyMaterial' --output text > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  echo "    Created, private half saved to $KEY_FILE -- AWS keeps no copy of it."
fi

# ---------------------------------------------------------------- the firewall

say "Security group"
SG_ID="$(aws_ ec2 describe-security-groups --filters "Name=group-name,Values=$NAME" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo 'None')"

if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  SG_ID="$(aws_ ec2 create-security-group --group-name "$NAME" \
    --description "Simple Sales Book: web in, ssh from the office" \
    --query 'GroupId' --output text)"
  echo "    Created $SG_ID"
else
  echo "    Reusing $SG_ID"
fi

# 80 and 443 to the world: 80 is how Let's Encrypt proves the certificate, 443 is the app.
# Port 4000 is deliberately absent -- the Node server is only ever reached through Caddy.
for PORT in 80 443; do
  aws_ ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp \
    --port "$PORT" --cidr 0.0.0.0/0 >/dev/null 2>&1 && echo "    Opened $PORT" \
    || echo "    $PORT already open"
done

# SSH only from here. A box with 22 open to the whole internet spends its life being probed.
MY_IP="$(curl -fsS --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]')"
aws_ ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp \
  --port 22 --cidr "$MY_IP/32" >/dev/null 2>&1 && echo "    Opened 22 to $MY_IP only" \
  || echo "    22 already open to $MY_IP"

# ---------------------------------------------------------------- the machine

say "Instance"
INSTANCE_ID="$(aws_ ec2 describe-instances \
  --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=pending,running,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || echo 'None')"

if [ "$INSTANCE_ID" = "None" ] || [ -z "$INSTANCE_ID" ]; then
  # Canonical's own published pointer to the current Ubuntu 24.04 image, rather than an AMI id
  # copied from a guide -- those are per-region and go stale.
  AMI="$(aws_ ssm get-parameters \
    --names /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query 'Parameters[0].Value' --output text)"
  [ -n "$AMI" ] && [ "$AMI" != "None" ] || die "Could not look up the Ubuntu 24.04 image id."
  echo "    Ubuntu 24.04 image: $AMI"

  INSTANCE_ID="$(aws_ ec2 run-instances \
    --image-id "$AMI" --instance-type "$TYPE" --key-name "$NAME" \
    --security-group-ids "$SG_ID" \
    --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":20,"VolumeType":"gp3","DeleteOnTermination":true}}]' \
    --metadata-options 'HttpTokens=required' \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" \
    --query 'Instances[0].InstanceId' --output text)"
  echo "    Launched $INSTANCE_ID"
else
  echo "    Reusing $INSTANCE_ID"
  STATE="$(aws_ ec2 describe-instances --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].State.Name' --output text)"
  [ "$STATE" != "stopped" ] || { aws_ ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null; echo "    Starting it."; }
fi

echo "    Waiting for it to be running"
aws_ ec2 wait instance-running --instance-ids "$INSTANCE_ID"

# ---------------------------------------------------------------- the address

say "Elastic IP"
ALLOC_ID="$(aws_ ec2 describe-addresses --filters "Name=tag:Name,Values=$NAME" \
  --query 'Addresses[0].AllocationId' --output text 2>/dev/null || echo 'None')"

if [ "$ALLOC_ID" = "None" ] || [ -z "$ALLOC_ID" ]; then
  ALLOC_ID="$(aws_ ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" \
    --query 'AllocationId' --output text)"
  echo "    Allocated $ALLOC_ID"
else
  echo "    Reusing $ALLOC_ID"
fi

aws_ ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID" >/dev/null
IP="$(aws_ ec2 describe-addresses --allocation-ids "$ALLOC_ID" --query 'Addresses[0].PublicIp' --output text)"

# An elastic IP costs nothing while it is attached to a running instance, and is billed by the
# hour if it is left allocated to nothing -- which is what happens if the instance is terminated
# and this is forgotten.

say "Waiting for SSH to answer"
for i in $(seq 1 40); do
  if ssh -i "$KEY_FILE" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes \
      "ubuntu@$IP" true 2>/dev/null; then
    echo "    Up."
    break
  fi
  sleep 8
done

cat <<DONE

  ------------------------------------------------------------------
   Instance   $INSTANCE_ID  ($TYPE, $REGION)
   Address    $IP           (elastic -- it will not change)
   Key        $KEY_FILE
   Firewall   $SG_ID        (80, 443 open; 22 from $MY_IP only)

   Log in with:
     ssh -i "$KEY_FILE" ubuntu@$IP

   Next: a hostname pointing at $IP, then deploy/bootstrap.sh.
  ------------------------------------------------------------------

DONE
