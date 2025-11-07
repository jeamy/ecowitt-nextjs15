#!/bin/bash

# Test script for Forecast Analysis
# Tests the same API calls that the frontend uses

echo "=========================================="
echo "FORECAST ANALYSIS TEST"
echo "=========================================="
echo ""

STATION_ID="${1:-11035}"
DAYS="${2:-7}"
BASE_URL="http://localhost:3010"

echo "Configuration:"
echo "  Station ID: $STATION_ID"
echo "  Days: $DAYS"
echo "  Base URL: $BASE_URL"
echo ""

# Test 1: Get forecast analysis data (same as frontend)
echo "=========================================="
echo "TEST 1: Forecast Analysis API"
echo "=========================================="
echo "GET /api/forecast/analysis?stationId=$STATION_ID&days=$DAYS"
echo ""

RESPONSE=$(curl -s "$BASE_URL/api/forecast/analysis?stationId=$STATION_ID&days=$DAYS")
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"

# Check if we have data
HAS_DATA=$(echo "$RESPONSE" | jq -r '.hasData' 2>/dev/null)
if [ "$HAS_DATA" = "true" ]; then
    echo ""
    echo "✓ Real analysis data available!"
    
    # Show summary
    DAILY_COUNT=$(echo "$RESPONSE" | jq '.dailyAnalysis | length' 2>/dev/null)
    echo "  - Days with analysis: $DAILY_COUNT"
    
    SOURCES=$(echo "$RESPONSE" | jq -r '.accuracyStats | keys[]' 2>/dev/null)
    echo "  - Sources: $SOURCES"
else
    echo ""
    echo "❌ No real data - showing demo data"
fi

echo ""
echo ""

# Test 2: Check database contents
echo "=========================================="
echo "TEST 2: Database Contents"
echo "=========================================="
echo "GET /api/debug/db"
echo ""

DB_RESPONSE=$(curl -s "$BASE_URL/api/debug/db")

# Extract forecasts table info
FORECASTS_COUNT=$(echo "$DB_RESPONSE" | jq -r '.tables[] | select(.tableName=="forecasts") | .rowCount' 2>/dev/null)
echo "--- FORECASTS TABLE ---"
echo "Total rows: $FORECASTS_COUNT"

if [ "$FORECASTS_COUNT" != "null" ] && [ "$FORECASTS_COUNT" != "0" ]; then
    echo ""
    echo "Sample data:"
    echo "$DB_RESPONSE" | jq -r '.tables[] | select(.tableName=="forecasts") | .sampleData[]' 2>/dev/null | head -5
    
    echo ""
    echo "Forecasts by date and source:"
    echo "$DB_RESPONSE" | jq -r '.tables[] | select(.tableName=="forecasts") | .sampleData[] | "\(.storage_date) | \(.source)"' 2>/dev/null | sort -u
fi

echo ""
echo ""

# Extract forecast_analysis table info
ANALYSIS_COUNT=$(echo "$DB_RESPONSE" | jq -r '.tables[] | select(.tableName=="forecast_analysis") | .rowCount' 2>/dev/null)
echo "--- FORECAST_ANALYSIS TABLE ---"
echo "Total rows: $ANALYSIS_COUNT"

if [ "$ANALYSIS_COUNT" != "null" ] && [ "$ANALYSIS_COUNT" != "0" ]; then
    echo ""
    echo "Sample data:"
    echo "$DB_RESPONSE" | jq -r '.tables[] | select(.tableName=="forecast_analysis") | .sampleData[]' 2>/dev/null | head -5
    
    echo ""
    echo "Analysis by date and source:"
    echo "$DB_RESPONSE" | jq -r '.tables[] | select(.tableName=="forecast_analysis") | .sampleData[] | "\(.analysis_date) | \(.source)"' 2>/dev/null | sort -u
else
    echo "❌ EMPTY - This is why frontend shows demo data!"
fi

echo ""
echo ""

# Test 3: Get station config
echo "=========================================="
echo "TEST 3: Station Configuration"
echo "=========================================="
echo "GET /api/config/forecast-station"
echo ""

CONFIG_RESPONSE=$(curl -s "$BASE_URL/api/config/forecast-station")
echo "$CONFIG_RESPONSE" | jq '.' 2>/dev/null || echo "$CONFIG_RESPONSE"

echo ""
echo ""

# Summary
echo "=========================================="
echo "SUMMARY"
echo "=========================================="

if [ "$HAS_DATA" = "true" ]; then
    echo "✓ Forecast Analysis: WORKING"
    echo "✓ Real data available"
    echo "✓ Frontend will show real data"
else
    echo "⚠ Forecast Analysis: Waiting for data"
    echo "  Forecasts in DB: $FORECASTS_COUNT rows"
    echo "  Analysis in DB: $ANALYSIS_COUNT rows"
    
    if [ "$FORECASTS_COUNT" != "null" ] && [ "$FORECASTS_COUNT" != "0" ]; then
        echo ""
        echo "  ✓ Forecasts are being stored"
        echo "  ⏳ Waiting for analysis to run (next midnight)"
    else
        echo ""
        echo "  ❌ No forecasts in database"
        echo "  Check if midnight poller is running"
    fi
fi

echo ""
echo "=========================================="
