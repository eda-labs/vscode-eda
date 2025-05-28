#!/bin/bash

export EDA_API_URL="https://eda-api.k8s.orb.local"
export EDA_VERSION="v25.4.1"
export KC_KEYCLOAK_URL="${EDA_API_URL}/core/httpproxy/v1/keycloak/"
export KC_REALM="master"
export KC_CLIENT_ID="admin-cli"
export KC_USERNAME="admin"
export KC_PASSWORD="admin"

# Get access token
KC_ADMIN_ACCESS_TOKEN=$(curl -sk \
  -X POST "$KC_KEYCLOAK_URL/realms/$KC_REALM/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=$KC_CLIENT_ID" \
  -d "username=$KC_USERNAME" \
  -d "password=$KC_PASSWORD" \
  | jq -r '.access_token')

if [ -z "$KC_ADMIN_ACCESS_TOKEN" ]; then
  echo "Failed to obtain keycloak admin token"
  exit 1
fi

export EDA_REALM="eda"
export API_CLIENT_ID="eda"
# Fetch all clients in the 'eda-realm'
KC_CLIENTS=$(curl -sk \
  -X GET "$KC_KEYCLOAK_URL/admin/realms/$EDA_REALM/clients" \
  -H "Authorization: Bearer $KC_ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json")

echo ${KC_CLIENTS}

# Get the `eda` client's ID
EDA_CLIENT_ID=$(echo "$KC_CLIENTS" | jq -r ".[] | select(.clientId==\"${API_CLIENT_ID}\") | .id")

if [ -z "$EDA_CLIENT_ID" ]; then
  echo "Client 'eda' not found in realm 'eda-realm'"
  exit 1
fi

# Fetch the client secret
EDA_CLIENT_SECRET=$(curl -sk \
  -X GET "$KC_KEYCLOAK_URL/admin/realms/$EDA_REALM/clients/$EDA_CLIENT_ID/client-secret" \
  -H "Authorization: Bearer $KC_ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  | jq -r '.value')

if [ -z "$EDA_CLIENT_SECRET" ]; then
  echo "Failed to fetch client secret"
  exit 1
fi

export EDA_CLIENT_SECRET

# echo "EDA Client Secret: $EDA_CLIENT_SECRET"

EDA_ACCESS_TOKEN=$(curl -sk "${EDA_API_URL}/core/httpproxy/v1/keycloak/realms/${EDA_REALM}/protocol/openid-connect/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'client_id=eda' \
  --data-urlencode 'grant_type=password' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'username=admin' \
  --data-urlencode 'password=admin' \
  --data-urlencode "client_secret=${EDA_CLIENT_SECRET}" \
  -H 'Content-Type: application/json' | jq -r '.access_token')

# echo "EDA Access Token: $EDA_ACCESS_TOKEN"

# mkdir -p versions/${EDA_VERSION}


EDA_APIS=$(curl -sk ${EDA_API_URL}/openapi/v3 \
  -H "Authorization: Bearer ${EDA_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json')

echo $EDA_APIS | jq .

echo "$EDA_APIS" | jq -r '.paths | to_entries[] | .key + " " + .value.serverRelativeURL' | while read -r path url; do
    # Create directory structure
    mkdir -p "./${path}"

    # Create filename from path
    filename="$(echo $path | cut -d '/' -f 3 | cut -d '.' -f 1).json"
    # if filename is empty, name it core
    if [ "$filename" == ".json" ]; then
        filename="core.json"
    fi
    
    # Fetch the API spec
    echo "Fetching ${EDA_API_URL}${url}"
    curl -sk "${EDA_API_URL}${url}" \
        -H "Authorization: Bearer ${EDA_ACCESS_TOKEN}" \
        -H 'Content-Type: application/json' | jq . > "./${path}/${filename}"
        
    echo "Fetched ${path} to ${path}/${filename}"
done

# fetch core api
# curl -sk "${EDA_API_URL}/openapi/v3/core" \
#   -H "Authorization: Bearer $EDA_ACCESS_TOKEN" \
#   -H 'Content-Type: application/json' > assets/openapi/${EDA_VERSION}/core.json

# # fetch interfaces api
# curl -sk "${EDA_API_URL}/openapi/v3/apps/interfaces.eda.nokia.com/v1alpha1" \
#   -H "Authorization: Bearer $EDA_ACCESS_TOKEN" \
#   -H 'Content-Type: application/json' > assets/openapi/${EDA_VERSION}/interfaces.json