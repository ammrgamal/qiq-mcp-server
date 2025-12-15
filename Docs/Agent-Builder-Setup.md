# Agent Builder Setup Guide - QIQ MCP Search

## إعداد الاتصال في Agent Builder

### 1. القيم المطلوبة

```
Server URL: https://mcp2.quickitquote.com/sse
Authentication: None
```

### 2. الأداة المتاحة

**Tool Name:** `qiq_http_search`

**Description:** Search products via QIQ HTTP endpoint using q as query and return MCP-friendly JSON.

**Input Schema:**
- `q` (string, required): Query string to search products

**Output:** Returns array of product data matching the query.

---

## اختبار الأداة في Agent Builder

### أمثلة Queries للاختبار:

#### 1. البحث عن منتج محدد بالكود
```
Search for product KL4069IA1YRS
```

#### 2. البحث عن منتجات Kaspersky
```
What Kaspersky products are available?
```

#### 3. البحث عن antivirus products
```
Search for antivirus software
```

#### 4. البحث بالبراند
```
Find all Lenovo products
```

---

## التحقق من الاتصال

### 1. عبر curl (من Terminal)

#### اختبار Info Endpoint:
```powershell
curl -k https://mcp2.quickitquote.com/mcp/info
```

يجب أن ترجع JSON تحتوي على:
- `initialize` مع `protocolVersion: "2024-11-05"`
- `toolsList` تحتوي على `qiq_http_search`

#### اختبار Tools Endpoint:
```powershell
curl -k https://mcp2.quickitquote.com/mcp/tools
```

يجب أن ترجع array تحتوي على tool definition.

### 2. عبر Agent Builder UI

1. افتح Agent Builder
2. اضغط على "Add MCP Server"
3. أدخل القيم:
   - **Server URL:** `https://mcp2.quickitquote.com/sse`
   - **Authentication:** None
4. احفظ
5. تحقق من ظهور `qiq_http_search` في قائمة Tools

---

## الناتج المتوقع

عند استخدام `qiq_http_search` مع query مثل `"KL4069IA1YRS"`:

```json
{
  "content": [
    {
      "type": "json",
      "json": {
        "object_id": "KL4069IA1YRS",
        "name": "Kaspersky Internet Security...",
        "brand": "Kaspersky",
        "category": "Software",
        "price": "...",
        // ... more product fields
      }
    }
  ]
}
```

---

## معلومات إضافية

### Backend
- **Typesense Collection:** quickitquote_products
- **Query Fields:** object_id, name, brand, category
- **Search Endpoint:** https://quickitquote.com/api/search

### Server Details
- **VPS IP:** 109.199.105.196
- **Port:** 3003 (internal)
- **Domain:** mcp2.quickitquote.com
- **Certificate:** Let's Encrypt (expires 2026-03-15)

### Transports Supported
- **SSE:** https://mcp2.quickitquote.com/sse
- **HTTP:** https://mcp2.quickitquote.com/http

### Discovery Endpoints
- `/mcp/info` - Returns initialize + tools list
- `/mcp/tools` - Returns tools array
- `/.well-known/mcp.json` - Discovery document
- `/whoami` - Returns server identifier

---

## Troubleshooting

### إذا ظهرت رسالة "Unable to load tools":
1. تحقق من أن Server URL ينتهي بـ `/sse` أو `/http`
2. تحقق من اختيار Authentication = None
3. جرب curl على `/mcp/info` للتأكد من الاستجابة

### إذا فشل Tool Call:
1. تحقق من أن `q` parameter ليس فارغ
2. جرب query بسيط مثل `"Kaspersky"` أولاً
3. تحقق من Typesense backend health

### للتحقق من Backend:
```powershell
# Direct port test
curl http://109.199.105.196:3003/mcp/info

# HTTPS test
curl -k https://mcp2.quickitquote.com/mcp/info
```

---

## Status

✅ **Operational** - Agent Builder successfully connects and discovers tools as of December 15, 2025.

**Last Verified:** December 15, 2025  
**Status:** Working  
**User Confirmation:** "اشتغل" (It works!)
