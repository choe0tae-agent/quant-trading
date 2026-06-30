from flask import Flask, render_template, jsonify, request, Response, stream_with_context
import data_source
import os
import requests
import json

app = Flask(__name__)

@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/sources')
def api_sources():
    try:
        sources = data_source.get_available_sources()
        return jsonify(sources)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/symbols')
def api_symbols():
    source_name = request.args.get('source')
    if not source_name:
        return jsonify({"error": "Missing 'source' parameter"}), 400
    
    try:
        sources = data_source.get_available_sources()
        if source_name in sources:
            return jsonify({"symbols": sources[source_name]["symbols"]})
        else:
            return jsonify({"error": f"Source '{source_name}' not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/history')
def api_history():
    source_name = request.args.get('source')
    symbol = request.args.get('symbol')
    timeframe = request.args.get('timeframe')
    limit = request.args.get('limit', default=500, type=int)  # increased default limit for indicator calculations
    
    if not all([source_name, symbol, timeframe]):
        return jsonify({"error": "Missing 'source', 'symbol', or 'timeframe' parameter"}), 400
        
    try:
        data = data_source.get_source_data(source_name, symbol, timeframe, limit)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/quote')
def api_quote():
    source_name = request.args.get('source')
    symbol = request.args.get('symbol')
    
    if not all([source_name, symbol]):
        return jsonify({"error": "Missing 'source' or 'symbol' parameter"}), 400
        
    try:
        quote = data_source.get_source_quote(source_name, symbol)
        if quote:
            return jsonify(quote)
        else:
            return jsonify({"error": "No quote available"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ==========================================
# AI Chatbot Integration
# ==========================================

def load_env_file():
    try:
        env_path = os.path.join(os.path.dirname(__file__), '.env')
        if os.path.exists(env_path):
            with open(env_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, val = line.split('=', 1)
                        os.environ[key.strip()] = val.strip()
    except Exception as e:
        print(f"Warning: Failed to load .env file manually: {e}")

load_env_file()

def call_ai_provider(provider, model, api_key, ollama_url, messages, system_prompt, chart_image=None):
    headers = {"Content-Type": "application/json"}
    
    if provider == "ollama":
        url = f"{ollama_url.rstrip('/')}/api/chat"
        ollama_messages = [{"role": "system", "content": system_prompt}]
        user_msgs = [m for m in messages if m.get("role") == "user"]
        last_user_msg = user_msgs[-1] if user_msgs else None
        
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content", "")
            m_role = "user" if role == "user" else "assistant"
            m_obj = {"role": m_role, "content": content}
            
            if role == "user" and msg == last_user_msg and chart_image:
                raw_base64 = chart_image
                if "," in raw_base64:
                    raw_base64 = raw_base64.split(",", 1)[1]
                m_obj["images"] = [raw_base64]
            ollama_messages.append(m_obj)
            
        payload = {"model": model, "messages": ollama_messages, "stream": True}
        response = requests.post(url, json=payload, headers=headers, stream=True, timeout=60)
        if response.status_code != 200:
            raise Exception(f"Ollama API error ({response.status_code}): {response.text}")
        for line in response.iter_lines():
            if line:
                try:
                    data = json.loads(line.decode('utf-8'))
                    content = data.get("message", {}).get("content", "")
                    if content:
                        yield content
                except Exception:
                    pass
        
    elif provider == "openai":
        url = "https://api.openai.com/v1/chat/completions"
        headers["Authorization"] = f"Bearer {api_key}"
        openai_messages = [{"role": "system", "content": system_prompt}]
        user_msgs = [m for m in messages if m.get("role") == "user"]
        last_user_msg = user_msgs[-1] if user_msgs else None
        
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content", "")
            if role == "user" and msg == last_user_msg and chart_image:
                m_content = [
                    {"type": "text", "text": content},
                    {"type": "image_url", "image_url": {"url": chart_image}}
                ]
            else:
                m_content = content
            openai_messages.append({
                "role": "user" if role == "user" else "assistant",
                "content": m_content
            })
            
        payload = {"model": model, "messages": openai_messages, "stream": True}
        response = requests.post(url, json=payload, headers=headers, stream=True, timeout=60)
        if response.status_code != 200:
            raise Exception(f"OpenAI API error ({response.status_code}): {response.text}")
        for line in response.iter_lines():
            if line:
                decoded = line.decode('utf-8').strip()
                if decoded.startswith("data: "):
                    data_str = decoded[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                        content = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        if content:
                            yield content
                    except Exception:
                        pass

    elif provider == "claude":
        url = "https://api.anthropic.com/v1/messages"
        headers["x-api-key"] = api_key
        headers["anthropic-version"] = "2023-06-01"
        claude_messages = []
        user_msgs = [m for m in messages if m.get("role") == "user"]
        last_user_msg = user_msgs[-1] if user_msgs else None
        
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content", "")
            if role == "system":
                continue
            m_role = "user" if role == "user" else "assistant"
            if role == "user" and msg == last_user_msg and chart_image:
                raw_base64 = chart_image
                if "," in raw_base64:
                    raw_base64 = raw_base64.split(",", 1)[1]
                m_content = [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": raw_base64
                        }
                    },
                    {"type": "text", "text": content}
                ]
            else:
                m_content = content
            claude_messages.append({"role": m_role, "content": m_content})
            
        payload = {
            "model": model, "max_tokens": 4096, "system": system_prompt,
            "messages": claude_messages, "stream": True
        }
        response = requests.post(url, json=payload, headers=headers, stream=True, timeout=60)
        if response.status_code != 200:
            raise Exception(f"Claude API error ({response.status_code}): {response.text}")
        for line in response.iter_lines():
            if line:
                decoded = line.decode('utf-8').strip()
                if decoded.startswith("data: "):
                    data_str = decoded[6:]
                    try:
                        data = json.loads(data_str)
                        if data.get("type") == "content_block_delta":
                            content = data.get("delta", {}).get("text", "")
                            if content:
                                yield content
                    except Exception:
                        pass

    elif provider == "gemini":
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?key={api_key}&alt=sse"
        gemini_contents = []
        user_msgs = [m for m in messages if m.get("role") == "user"]
        last_user_msg = user_msgs[-1] if user_msgs else None
        
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content", "")
            if role == "system":
                continue
            m_role = "user" if role == "user" else "model"
            if role == "user" and msg == last_user_msg and chart_image:
                raw_base64 = chart_image
                if "," in raw_base64:
                    raw_base64 = raw_base64.split(",", 1)[1]
                parts = [
                    {"text": content},
                    {"inlineData": {"mimeType": "image/png", "data": raw_base64}}
                ]
            else:
                parts = [{"text": content}]
            gemini_contents.append({"role": m_role, "parts": parts})
            
        payload = {
            "contents": gemini_contents,
            "systemInstruction": {"parts": [{"text": system_prompt}]}
        }
        response = requests.post(url, json=payload, headers=headers, stream=True, timeout=60)
        if response.status_code != 200:
            raise Exception(f"Gemini API error ({response.status_code}): {response.text}")
        
        for line in response.iter_lines():
            if line:
                decoded = line.decode('utf-8').strip()
                if decoded.startswith("data: "):
                    data_str = decoded[6:]
                    try:
                        data = json.loads(data_str)
                        content = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                        if content:
                            yield content
                    except Exception:
                        pass

    elif provider == "openrouter":
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers["Authorization"] = f"Bearer {api_key}"
        headers["HTTP-Referer"] = "https://github.com/google/antigravity"
        headers["X-Title"] = "Rolling Z-Score Trend Dashboard"
        
        openrouter_messages = [{"role": "system", "content": system_prompt}]
        user_msgs = [m for m in messages if m.get("role") == "user"]
        last_user_msg = user_msgs[-1] if user_msgs else None
        
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content", "")
            if role == "user" and msg == last_user_msg and chart_image:
                m_content = [
                    {"type": "text", "text": content},
                    {"type": "image_url", "image_url": {"url": chart_image}}
                ]
            else:
                m_content = content
            openrouter_messages.append({
                "role": "user" if role == "user" else "assistant",
                "content": m_content
            })
            
        payload = {
            "model": model,
            "messages": openrouter_messages,
            "stream": True,
            "max_tokens": 1500
        }
        response = requests.post(url, json=payload, headers=headers, stream=True, timeout=60)
        if response.status_code != 200:
            raise Exception(f"OpenRouter API error ({response.status_code}): {response.text}")
        for line in response.iter_lines():
            if line:
                decoded = line.decode('utf-8').strip()
                if decoded.startswith("data: "):
                    data_str = decoded[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                        content = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        if content:
                            yield content
                    except Exception:
                        pass
    else:
        raise Exception(f"Unknown provider: {provider}")

@app.route('/api/chat', methods=['POST'])
def api_chat():
    try:
        data = request.json or {}
        provider = data.get("provider")
        model = data.get("model")
        api_key = data.get("api_key")
        ollama_url = data.get("ollama_url", "http://localhost:11434")
        messages = data.get("messages", [])
        system_prompt = data.get("system_prompt")
        chart_image = data.get("chart_image")
        
        if not api_key:
            if provider == "openai":
                api_key = os.environ.get("OPENAI_API_KEY")
            elif provider == "claude":
                api_key = os.environ.get("ANTHROPIC_API_KEY")
            elif provider == "gemini":
                api_key = os.environ.get("GEMINI_API_KEY")
            elif provider == "openrouter":
                api_key = os.environ.get("OPENROUTER_API_KEY")
                
        if provider != "ollama" and not api_key:
            return jsonify({"error": f"{provider.upper()} API 키가 없습니다. .env 파일에 설정해 주세요."}), 400
            
        if not messages:
            return jsonify({"error": "메시지 내역이 없습니다."}), 400
            
        generator = call_ai_provider(provider, model, api_key, ollama_url, messages, system_prompt, chart_image)
        
        def generate():
            try:
                for chunk in generator:
                    yield json.dumps({"choices": [{"delta": {"content": chunk}}]}) + "\n"
            except Exception as e:
                import traceback
                traceback.print_exc()
                yield json.dumps({"error": str(e)}) + "\n"
                
        return Response(stream_with_context(generate()), mimetype='text/event-stream')
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)
