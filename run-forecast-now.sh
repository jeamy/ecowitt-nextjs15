#!/bin/bash

# Run forecast storage and analysis immediately (without waiting for midnight)
# This script calls the same functions that the midnight poller uses

echo "=========================================="
echo "RUN FORECAST STORAGE & ANALYSIS NOW"
echo "=========================================="
echo ""

STATION_ID="${1:-11035}"
BASE_URL="${2:-http://localhost:3010}"

echo "Configuration:"
echo "  Station ID: $STATION_ID"
echo "  Base URL: $BASE_URL"
echo ""

# Step 1: Store forecasts
echo "=========================================="
echo "STEP 1: Store Forecasts"
echo "=========================================="
echo "POST /api/forecast/store"
echo ""

STORE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/forecast/store" \
  -H "Content-Type: application/json" \
  -d "{\"stationId\":\"$STATION_ID\"}")

echo "$STORE_RESPONSE" | jq '.' 2>/dev/null || echo "$STORE_RESPONSE"

STORE_SUCCESS=$(echo "$STORE_RESPONSE" | jq -r '.success' 2>/dev/null)

if [ "$STORE_SUCCESS" = "true" ]; then
    echo ""
    echo "✓ Forecasts stored successfully"
else
    echo ""
    echo "✗ Failed to store forecasts"
    echo "Error: $STORE_RESPONSE"
    exit 1
fi

echo ""
echo "Waiting 2 seconds..."
sleep 2
echo ""

# Step 2: Run analysis
echo "=========================================="
echo "STEP 2: Calculate Analysis"
echo "=========================================="
echo "POST /api/forecast/analyze"
echo ""

ANALYZE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/forecast/analyze" \
  -H "Content-Type: application/json" \
  -d "{\"stationId\":\"$STATION_ID\"}")

echo "$ANALYZE_RESPONSE" | jq '.' 2>/dev/null || echo "$ANALYZE_RESPONSE"

ANALYZE_OK=$(echo "$ANALYZE_RESPONSE" | jq -r '.ok' 2>/dev/null)

if [ "$ANALYZE_OK" = "true" ]; then
    echo ""
    echo "✓ Analysis completed"
else
    echo ""
    echo "⚠ Analysis completed (may have warnings - check logs)"
fi

echo ""
echo "Waiting 1 second..."
sleep 1
echo ""

# Step 3: Check results
echo "=========================================="
echo "STEP 3: Check Results"
echo "=========================================="
echo ""

# Check database
echo "--- Database Contents ---"
DB_RESPONSE=$(curl -s "$BASE_URL/api/debug/db")

FORECASTS_COUNT=$(echo "$DB_RESPONSE" | jq -r '.tables[] | select(.tableName=="forecasts") | .rowCount' 2>/dev/null)
ANALYSIS_COUNT=$(echo "$DB_RESPONSE" | jq -r '.tables[] | select(.tableName=="forecast_analysis") | .rowCount' 2>/dev/null)

echo "Forecasts table: $FORECASTS_COUNT rows"
echo "Analysis table: $ANALYSIS_COUNT rows"

if [ "$ANALYSIS_COUNT" != "null" ] && [ "$ANALYSIS_COUNT" != "0" ]; then
    echo ""
    echo "Analysis by date and source:"
    echo "$DB_RESPONSE" | jq -r '.tables[] | select(.tableName=="forecast_analysis") | .sampleData[] | "\(.analysis_date) | \(.source) | TMinErr=\(.temp_min_error) TMaxErr=\(.temp_max_error)"' 2>/dev/null | head -10
fi

echo ""
echo ""

# Check API response
echo "--- API Response ---"
API_RESPONSE=$(curl -s "$BASE_URL/api/forecast/analysis?stationId=$STATION_ID&days=7")
HAS_DATA=$(echo "$API_RESPONSE" | jq -r '.hasData' 2>/dev/null)
DAILY_COUNT=$(echo "$API_RESPONSE" | jq '.dailyAnalysis | length' 2>/dev/null)

echo "hasData: $HAS_DATA"
echo "Daily analysis entries: $DAILY_COUNT"

echo ""
echo ""

# Summary
echo "=========================================="
echo "SUMMARY"
echo "=========================================="

if [ "$HAS_DATA" = "true" ]; then
    echo "✓✓✓ SUCCESS! ✓✓✓"
    echo ""
    echo "✓ Forecasts stored: $FORECASTS_COUNT rows"
    echo "✓ Analysis calculated: $ANALYSIS_COUNT rows"
    echo "✓ API returns real data"
    echo "✓ Frontend will show real data (no demo data)"
    echo ""
    echo "Open http://localhost:3010/analyse to see the results!"
else
    echo "⚠ PARTIAL SUCCESS"
    echo ""
    echo "✓ Forecasts stored: $FORECASTS_COUNT rows"
    
    if [ "$ANALYSIS_COUNT" = "0" ] || [ "$ANALYSIS_COUNT" = "null" ]; then
        echo "✗ Analysis failed: No data in forecast_analysis table"
        echo ""
        echo "Possible reasons:"
        echo "  1. No forecasts from yesterday available (need forecasts stored before today)"
        echo "  2. No actual weather data available from Geosphere yet"
        echo "  3. Check server logs for errors"
        echo ""
        echo "Solution:"
        echo "  - Wait until tomorrow (midnight poller will have yesterday's forecasts)"
        echo "  - Or check server logs: docker logs <container> | grep forecast-analysis"
    else
        echo "⚠ Analysis exists but API returns no data"
        echo "  Check API logs for errors"
    fi
fi

echo ""
echo "=========================================="
