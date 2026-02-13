#!/bin/bash
# Helper script to export HUBSPOT_ACCESS_TOKEN from .env for shell use
# Usage: source scripts/export_hubspot_token.sh
# Then you can use $HUBSPOT_ACCESS_TOKEN in curl commands

if [ -f .env ]; then
  export $(grep HUBSPOT_ACCESS_TOKEN .env | xargs)
  echo "HUBSPOT_ACCESS_TOKEN exported (starts with ${HUBSPOT_ACCESS_TOKEN:0:7}...)"
else
  echo "Error: .env file not found"
  exit 1
fi
