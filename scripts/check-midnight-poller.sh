#!/bin/bash

echo "=========================================="
echo "CHECK MIDNIGHT POLLER STATUS"
echo "=========================================="
echo ""

# Check if server is running
echo "1. Checking if server is running..."
SERVER_RESPONSE=$(curl -s http://localhost:3010/api/config/forecast-station 2>&1)
if [ $? -eq 0 ]; then
    echo "   ✓ Server is running"
else
    echo "   ✗ Server is NOT running!"
    exit 1
fi

echo ""
echo "2. Checking environment variables..."
echo "   FORECAST_STATION_ID from API:"
STATION_FROM_API=$(echo "$SERVER_RESPONSE" | jq -r '.stationId' 2>/dev/null)
echo "   → $STATION_FROM_API"

echo ""
echo "3. Checking database for today's forecasts..."
TODAY=$(date +%Y-%m-%d)
echo "   Today: $TODAY"

DB_RESPONSE=$(curl -s http://localhost:3010/api/debug/db)
TOTAL_FORECASTS=$(echo "$DB_RESPONSE" | jq -r '.tables[] | select(.tableName=="forecasts") | .rowCount' 2>/dev/null)
echo "   Total forecasts in DB: $TOTAL_FORECASTS"

# Try to get sample data to see dates
echo ""
echo "4. Checking forecast storage dates..."
SAMPLE_DATA=$(echo "$DB_RESPONSE" | jq -r '.tables[] | select(.tableName=="forecasts") | .sampleData[]' 2>/dev/null)

if [ -n "$SAMPLE_DATA" ]; then
    echo "   Sample forecasts (first 3):"
    echo "$SAMPLE_DATA" | jq -r '"\(.storage_date) | \(.station_id) | \(.forecast_date) | \(.source)"' 2>/dev/null | head -3
    
    echo ""
    echo "   Unique storage dates:"
    echo "$SAMPLE_DATA" | jq -r '.storage_date' 2>/dev/null | sort -u
    
    # Check if today's date exists
    HAS_TODAY=$(echo "$SAMPLE_DATA" | jq -r '.storage_date' 2>/dev/null | grep -c "$TODAY")
    
    if [ "$HAS_TODAY" -gt 0 ]; then
        echo ""
        echo "   ✓ Forecasts from TODAY ($TODAY) found!"
        echo "   → Midnight poller ran successfully"
    else
        echo ""
        echo "   ✗ NO forecasts from TODAY ($TODAY)"
        echo "   → Midnight poller did NOT run yet"
    fi
else
    echo "   ✗ No sample data available"
fi

echo ""
echo "5. Checking analysis table..."
ANALYSIS_COUNT=$(echo "$DB_RESPONSE" | jq -r '.tables[] | select(.tableName=="forecast_analysis") | .rowCount' 2>/dev/null)
echo "   Analysis records: $ANALYSIS_COUNT"

if [ "$ANALYSIS_COUNT" = "0" ] || [ "$ANALYSIS_COUNT" = "null" ]; then
    echo "   ✗ No analysis data"
    echo "   → This is expected if:"
    echo "      - Midnight poller hasn't run yet today"
    echo "      - No forecasts from yesterday available"
fi

echo ""
echo "=========================================="
echo "DIAGNOSIS"
echo "=========================================="

if [ "$HAS_TODAY" -gt 0 ]; then
    echo "✓ Midnight poller is WORKING"
    echo "  - Forecasts stored today"
    echo "  - Analysis will run tomorrow (needs today's forecasts)"
else
    echo "⚠ Midnight poller status UNCLEAR"
    echo ""
    echo "Possible reasons:"
    echo "  1. Server started AFTER midnight (00:00)"
    echo "     → Poller only runs at midnight, not on startup"
    echo "     → Next run: tomorrow at 00:00"
    echo ""
    echo "  2. Server was not running at midnight"
    echo "     → Start server before midnight"
    echo ""
    echo "  3. Poller encountered an error"
    echo "     → Check server logs for [forecast] messages"
    echo ""
    echo "Solution:"
    echo "  - Run: ./run-forecast-now.sh"
    echo "  - Or wait until tomorrow 00:00"
fi

echo ""
echo "=========================================="
