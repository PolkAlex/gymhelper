package gym;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Json {
    private final String s;
    private int i;

    private Json(String s) {
        this.s = s;
    }

    public static Object parse(String text) {
        Json p = new Json(text);
        p.ws();
        Object v = p.value();
        p.ws();
        if (p.i < p.s.length()) throw new IllegalArgumentException("Trailing data at " + p.i);
        return v;
    }

    private Object value() {
        char c = peek();
        switch (c) {
            case '{': return obj();
            case '[': return arr();
            case '"': return str();
            case 't': expect("true"); return Boolean.TRUE;
            case 'f': expect("false"); return Boolean.FALSE;
            case 'n': expect("null"); return null;
            default: return num();
        }
    }

    private char peek() {
        ws();
        if (i >= s.length()) throw new IllegalArgumentException("Unexpected end of input");
        return s.charAt(i);
    }

    private void ws() {
        while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
    }

    private void expect(String lit) {
        if (!s.startsWith(lit, i)) throw new IllegalArgumentException("Expected " + lit + " at " + i);
        i += lit.length();
    }

    private Map<String, Object> obj() {
        Map<String, Object> m = new LinkedHashMap<>();
        i++;
        char c = peek();
        if (c == '}') {
            i++;
            return m;
        }
        while (true) {
            c = peek();
            if (c != '"') throw new IllegalArgumentException("Expected key at " + i);
            String k = str();
            c = peek();
            if (c != ':') throw new IllegalArgumentException("Expected ':' at " + i);
            i++;
            m.put(k, value());
            c = peek();
            if (c == ',') {
                i++;
                continue;
            }
            if (c == '}') {
                i++;
                return m;
            }
            throw new IllegalArgumentException("Expected ',' or '}' at " + i);
        }
    }

    private List<Object> arr() {
        List<Object> l = new ArrayList<>();
        i++;
        char c = peek();
        if (c == ']') {
            i++;
            return l;
        }
        while (true) {
            l.add(value());
            c = peek();
            if (c == ',') {
                i++;
                continue;
            }
            if (c == ']') {
                i++;
                return l;
            }
            throw new IllegalArgumentException("Expected ',' or ']' at " + i);
        }
    }

    private String str() {
        StringBuilder b = new StringBuilder();
        i++;
        while (true) {
            char c = s.charAt(i++);
            if (c == '"') return b.toString();
            if (c == '\\') {
                char e = s.charAt(i++);
                switch (e) {
                    case '"': b.append('"'); break;
                    case '\\': b.append('\\'); break;
                    case '/': b.append('/'); break;
                    case 'n': b.append('\n'); break;
                    case 'r': b.append('\r'); break;
                    case 't': b.append('\t'); break;
                    case 'b': b.append('\b'); break;
                    case 'f': b.append('\f'); break;
                    case 'u':
                        b.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                        i += 4;
                        break;
                    default: throw new IllegalArgumentException("Bad escape \\" + e);
                }
            } else {
                b.append(c);
            }
        }
    }

    private Object num() {
        int start = i;
        while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
        String t = s.substring(start, i);
        if (t.indexOf('.') < 0 && t.indexOf('e') < 0 && t.indexOf('E') < 0) return Long.parseLong(t);
        return Double.parseDouble(t);
    }

    public static String write(Object v) {
        StringBuilder b = new StringBuilder();
        writeValue(b, v);
        return b.toString();
    }

    private static void writeValue(StringBuilder b, Object v) {
        if (v == null) {
            b.append("null");
            return;
        }
        if (v instanceof String) {
            b.append(quote((String) v));
            return;
        }
        if (v instanceof Boolean) {
            b.append(v);
            return;
        }
        if (v instanceof Double) {
            double d = (Double) v;
            if (d == Math.floor(d) && !Double.isInfinite(d)) b.append((long) d);
            else b.append(d);
            return;
        }
        if (v instanceof Number) {
            b.append(v);
            return;
        }
        if (v instanceof Map) {
            b.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
                if (!first) b.append(',');
                first = false;
                b.append(quote(String.valueOf(e.getKey()))).append(':');
                writeValue(b, e.getValue());
            }
            b.append('}');
            return;
        }
        if (v instanceof List) {
            b.append('[');
            boolean first = true;
            for (Object o : (List<?>) v) {
                if (!first) b.append(',');
                first = false;
                writeValue(b, o);
            }
            b.append(']');
            return;
        }
        throw new IllegalArgumentException("Cannot serialize " + v.getClass());
    }

    public static String quote(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    public static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? null : (String) v;
    }

    public static long lng(Object v) {
        return v instanceof Number ? ((Number) v).longValue() : 0;
    }

    public static double dbl(Object v) {
        return v instanceof Number ? ((Number) v).doubleValue() : 0;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> map(Object v) {
        return (Map<String, Object>) v;
    }

    @SuppressWarnings("unchecked")
    public static List<Object> list(Object v) {
        return (List<Object>) v;
    }
}
