#!/bin/bash
echo "--- STARTING FULL DEMO TEST ---"
PORT=3000

# Start server in background
node server.js &
SERVER_PID=$!
sleep 3

# Test Health
echo -n "Testing /health... "
curl -s http://localhost:$PORT/health | grep "status\":\"ok\"" && echo "OK" || echo "FAIL"

# Test Config
echo -n "Testing /config/public... "
curl -s http://localhost:$PORT/config/public | grep "nom" && echo "OK" || echo "FAIL"

# Test Chat
echo -n "Testing Chat (Horaires)... "
curl -s -X POST -H "Content-Type: application/json" -d '{"message":"Quels sont vos horaires?"}' http://localhost:$PORT/chat | grep "horaires" && echo "OK" || echo "FAIL"

# Test Chat (Demo Response)
echo -n "Testing Chat (Bonjour)... "
curl -s -X POST -H "Content-Type: application/json" -d '{"message":"Bonjour"}' http://localhost:$PORT/chat | grep "assistant" && echo "OK" || echo "FAIL"

# Kill server
kill $SERVER_PID
echo "--- DEMO TEST FINISHED ---"
