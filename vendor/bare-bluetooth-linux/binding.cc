#include <assert.h>
#include <atomic>
#include <bare.h>
#include <dbus/dbus.h>
#include <js.h>
#include <jstl.h>
#include <optional>
#include <string>
#include <type_traits>
#include <unordered_map>
#include <uv.h>
#include <vector>

#define BLUEZ_BUS                "org.bluez"
#define DBUS_PROP_IFACE          "org.freedesktop.DBus.Properties"
#define DBUS_OM_IFACE            "org.freedesktop.DBus.ObjectManager"
#define BLUEZ_ADAPTER_IFACE      "org.bluez.Adapter1"
#define BLUEZ_DEVICE_IFACE       "org.bluez.Device1"
#define BLUEZ_GATT_SERVICE_IFACE "org.bluez.GattService1"
#define BLUEZ_GATT_CHAR_IFACE    "org.bluez.GattCharacteristic1"
#define BLUEZ_GATT_DESC_IFACE    "org.bluez.GattDescriptor1"
#define BLUEZ_LE_ADV_MGR_IFACE   "org.bluez.LEAdvertisingManager1"
#define BLUEZ_LE_ADV_IFACE       "org.bluez.LEAdvertisement1"
#define BLUEZ_GATT_MGR_IFACE     "org.bluez.GattManager1"
#define BLUEZ_ADV_PATH           "/com/bare/advertisement0"
#define DBUS_TIMEOUT             300
#define DBUS_CONNECT_TIMEOUT     30000
#define DBUS_POLL_INTERVAL       200

static std::optional<std::string>
dbus_get_string_prop(DBusConnection *conn, const char *path, const char *iface, const char *prop) {
  DBusMessage *msg =
    dbus_message_new_method_call(BLUEZ_BUS, path, DBUS_PROP_IFACE, "Get");
  dbus_message_append_args(msg, DBUS_TYPE_STRING, &iface, DBUS_TYPE_STRING, &prop, DBUS_TYPE_INVALID);

  DBusError err;
  dbus_error_init(&err);
  DBusMessage *reply =
    dbus_connection_send_with_reply_and_block(conn, msg, DBUS_TIMEOUT, &err);
  dbus_message_unref(msg);

  std::optional<std::string> result;
  if (reply && !dbus_error_is_set(&err)) {
    DBusMessageIter iter, variant;
    dbus_message_iter_init(reply, &iter);
    dbus_message_iter_recurse(&iter, &variant);
    if (dbus_message_iter_get_arg_type(&variant) == DBUS_TYPE_STRING) {
      const char *val;
      dbus_message_iter_get_basic(&variant, &val);
      result = val;
    }
    dbus_message_unref(reply);
  }
  if (dbus_error_is_set(&err))
    dbus_error_free(&err);

  return result;
}

static bool
dbus_get_bool_prop(DBusConnection *conn, const char *path, const char *iface, const char *prop) {
  DBusMessage *msg =
    dbus_message_new_method_call(BLUEZ_BUS, path, DBUS_PROP_IFACE, "Get");
  dbus_message_append_args(msg, DBUS_TYPE_STRING, &iface, DBUS_TYPE_STRING, &prop, DBUS_TYPE_INVALID);

  DBusError err;
  dbus_error_init(&err);
  DBusMessage *reply =
    dbus_connection_send_with_reply_and_block(conn, msg, DBUS_TIMEOUT, &err);
  dbus_message_unref(msg);

  bool result = false;
  if (reply && !dbus_error_is_set(&err)) {
    DBusMessageIter iter, variant;
    dbus_message_iter_init(reply, &iter);
    dbus_message_iter_recurse(&iter, &variant);
    if (dbus_message_iter_get_arg_type(&variant) == DBUS_TYPE_BOOLEAN) {
      dbus_bool_t val;
      dbus_message_iter_get_basic(&variant, &val);
      result = val;
    }
    dbus_message_unref(reply);
  }
  if (dbus_error_is_set(&err))
    dbus_error_free(&err);

  return result;
}

template <typename T>
static constexpr int
dbus_type_code() {
  if constexpr (std::is_same_v<T, int16_t>) return DBUS_TYPE_INT16;
  else if constexpr (std::is_same_v<T, uint16_t>) return DBUS_TYPE_UINT16;
  else if constexpr (std::is_same_v<T, int32_t>) return DBUS_TYPE_INT32;
  else if constexpr (std::is_same_v<T, uint32_t>) return DBUS_TYPE_UINT32;
  else if constexpr (std::is_same_v<T, int64_t>) return DBUS_TYPE_INT64;
  else if constexpr (std::is_same_v<T, uint64_t>) return DBUS_TYPE_UINT64;
}

template <typename T>
static std::optional<T>
dbus_get_numeric_prop(DBusConnection *conn, const char *path, const char *iface, const char *prop) {
  DBusMessage *msg =
    dbus_message_new_method_call(BLUEZ_BUS, path, DBUS_PROP_IFACE, "Get");
  dbus_message_append_args(msg, DBUS_TYPE_STRING, &iface, DBUS_TYPE_STRING, &prop, DBUS_TYPE_INVALID);

  DBusError err;
  dbus_error_init(&err);
  DBusMessage *reply =
    dbus_connection_send_with_reply_and_block(conn, msg, DBUS_TIMEOUT, &err);
  dbus_message_unref(msg);

  std::optional<T> result;
  if (reply && !dbus_error_is_set(&err)) {
    DBusMessageIter iter, variant;
    dbus_message_iter_init(reply, &iter);
    dbus_message_iter_recurse(&iter, &variant);
    if (dbus_message_iter_get_arg_type(&variant) == dbus_type_code<T>()) {
      T val;
      dbus_message_iter_get_basic(&variant, &val);
      result = val;
    }
    dbus_message_unref(reply);
  }
  if (dbus_error_is_set(&err))
    dbus_error_free(&err);

  return result;
}

static std::vector<std::string>
dbus_get_string_array_prop(DBusConnection *conn, const char *path, const char *iface, const char *prop) {
  DBusMessage *msg =
    dbus_message_new_method_call(BLUEZ_BUS, path, DBUS_PROP_IFACE, "Get");
  dbus_message_append_args(msg, DBUS_TYPE_STRING, &iface, DBUS_TYPE_STRING, &prop, DBUS_TYPE_INVALID);

  DBusError err;
  dbus_error_init(&err);
  DBusMessage *reply =
    dbus_connection_send_with_reply_and_block(conn, msg, DBUS_TIMEOUT, &err);
  dbus_message_unref(msg);

  std::vector<std::string> result;
  if (reply && !dbus_error_is_set(&err)) {
    DBusMessageIter iter, variant, array;
    dbus_message_iter_init(reply, &iter);
    dbus_message_iter_recurse(&iter, &variant);
    if (dbus_message_iter_get_arg_type(&variant) == DBUS_TYPE_ARRAY) {
      dbus_message_iter_recurse(&variant, &array);
      while (dbus_message_iter_get_arg_type(&array) == DBUS_TYPE_STRING) {
        const char *val;
        dbus_message_iter_get_basic(&array, &val);
        result.push_back(val);
        dbus_message_iter_next(&array);
      }
    }
    dbus_message_unref(reply);
  }
  if (dbus_error_is_set(&err))
    dbus_error_free(&err);

  return result;
}

static std::optional<std::string>
dbus_find_string_in_props(DBusMessageIter *props_iter, const char *target_prop) {
  while (dbus_message_iter_get_arg_type(props_iter) == DBUS_TYPE_DICT_ENTRY) {
    DBusMessageIter prop_entry;
    dbus_message_iter_recurse(props_iter, &prop_entry);

    const char *prop_name;
    dbus_message_iter_get_basic(&prop_entry, &prop_name);

    if (strcmp(prop_name, target_prop) == 0) {
      dbus_message_iter_next(&prop_entry);
      DBusMessageIter variant;
      dbus_message_iter_recurse(&prop_entry, &variant);
      if (dbus_message_iter_get_arg_type(&variant) == DBUS_TYPE_STRING) {
        const char *val;
        dbus_message_iter_get_basic(&variant, &val);
        return std::string(val);
      }
    }

    dbus_message_iter_next(props_iter);
  }
  return std::nullopt;
}

static void
dbus_set_bool_prop(DBusConnection *conn, const char *path, const char *iface, const char *prop, bool value) {
  DBusMessage *msg =
    dbus_message_new_method_call(BLUEZ_BUS, path, DBUS_PROP_IFACE, "Set");

  DBusMessageIter iter, variant;
  dbus_message_iter_init_append(msg, &iter);
  dbus_message_iter_append_basic(&iter, DBUS_TYPE_STRING, &iface);
  dbus_message_iter_append_basic(&iter, DBUS_TYPE_STRING, &prop);

  dbus_bool_t val = value ? TRUE : FALSE;
  dbus_message_iter_open_container(&iter, DBUS_TYPE_VARIANT, "b", &variant);
  dbus_message_iter_append_basic(&variant, DBUS_TYPE_BOOLEAN, &val);
  dbus_message_iter_close_container(&iter, &variant);

  DBusError err;
  dbus_error_init(&err);
  DBusMessage *reply =
    dbus_connection_send_with_reply_and_block(conn, msg, DBUS_TIMEOUT, &err);
  dbus_message_unref(msg);

  if (reply)
    dbus_message_unref(reply);
  if (dbus_error_is_set(&err))
    dbus_error_free(&err);
}

static void
dbus_dict_append_string(DBusMessageIter *dict, const char *key, const char *val) {
  DBusMessageIter entry, variant;
  dbus_message_iter_open_container(dict, DBUS_TYPE_DICT_ENTRY, nullptr, &entry);
  dbus_message_iter_append_basic(&entry, DBUS_TYPE_STRING, &key);
  dbus_message_iter_open_container(&entry, DBUS_TYPE_VARIANT, "s", &variant);
  dbus_message_iter_append_basic(&variant, DBUS_TYPE_STRING, &val);
  dbus_message_iter_close_container(&entry, &variant);
  dbus_message_iter_close_container(dict, &entry);
}

static void
dbus_dict_append_int16(DBusMessageIter *dict, const char *key, int16_t val) {
  DBusMessageIter entry, variant;
  dbus_message_iter_open_container(dict, DBUS_TYPE_DICT_ENTRY, nullptr, &entry);
  dbus_message_iter_append_basic(&entry, DBUS_TYPE_STRING, &key);
  dbus_message_iter_open_container(&entry, DBUS_TYPE_VARIANT, "n", &variant);
  dbus_message_iter_append_basic(&variant, DBUS_TYPE_INT16, &val);
  dbus_message_iter_close_container(&entry, &variant);
  dbus_message_iter_close_container(dict, &entry);
}

static void
dbus_dict_append_string_array(DBusMessageIter *dict, const char *key, const std::vector<std::string> &vals) {
  DBusMessageIter entry, variant, array;
  dbus_message_iter_open_container(dict, DBUS_TYPE_DICT_ENTRY, nullptr, &entry);
  dbus_message_iter_append_basic(&entry, DBUS_TYPE_STRING, &key);
  dbus_message_iter_open_container(&entry, DBUS_TYPE_VARIANT, "as", &variant);
  dbus_message_iter_open_container(&variant, DBUS_TYPE_ARRAY, "s", &array);
  for (const auto &s : vals) {
    const char *val = s.c_str();
    dbus_message_iter_append_basic(&array, DBUS_TYPE_STRING, &val);
  }
  dbus_message_iter_close_container(&variant, &array);
  dbus_message_iter_close_container(&entry, &variant);
  dbus_message_iter_close_container(dict, &entry);
}

static DBusPendingCall *
dbus_call_void_method(DBusConnection *conn, const char *path, const char *iface, const char *method, int timeout = DBUS_TIMEOUT) {
  DBusMessage *msg =
    dbus_message_new_method_call(BLUEZ_BUS, path, iface, method);

  DBusPendingCall *pending;
  dbus_connection_send_with_reply(conn, msg, &pending, timeout);
  dbus_message_unref(msg);

  return pending;
}

static std::optional<std::string>
dbus_call_void_method_sync(DBusConnection *conn, const char *path, const char *iface, const char *method, int timeout = DBUS_TIMEOUT) {
  DBusPendingCall *pending = dbus_call_void_method(conn, path, iface, method, timeout);

  dbus_pending_call_block(pending);
  DBusMessage *reply = dbus_pending_call_steal_reply(pending);
  dbus_pending_call_unref(pending);

  if (dbus_message_get_type(reply) == DBUS_MESSAGE_TYPE_ERROR) {
    DBusError err;
    dbus_error_init(&err);
    dbus_set_error_from_message(&err, reply);
    std::string error = err.message;
    dbus_error_free(&err);
    dbus_message_unref(reply);
    return error;
  }

  dbus_message_unref(reply);
  return std::nullopt;
}

struct bare_bluetooth_linux_adapter_t;

struct bare_bluetooth_linux_device_added_event_t {
  std::string path;
  std::string address;
};

struct bare_bluetooth_linux_device_removed_event_t {
  std::string path;
};

struct bare_bluetooth_linux_service_added_event_t {
  std::string path;
  std::string uuid;

  std::string
  device_path() const { return path.substr(0, path.rfind('/')); }
};

struct bare_bluetooth_linux_service_removed_event_t {
  std::string path;

  std::string
  device_path() const { return path.substr(0, path.rfind('/')); }
};

struct bare_bluetooth_linux_char_added_event_t {
  std::string path;
  std::string uuid;

  std::string
  service_path() const { return path.substr(0, path.rfind('/')); }
};

struct bare_bluetooth_linux_char_removed_event_t {
  std::string path;

  std::string
  service_path() const { return path.substr(0, path.rfind('/')); }
};

struct bare_bluetooth_linux_desc_added_event_t {
  std::string path;
  std::string uuid;

  std::string
  char_path() const { return path.substr(0, path.rfind('/')); }
};

struct bare_bluetooth_linux_desc_removed_event_t {
  std::string path;

  std::string
  char_path() const { return path.substr(0, path.rfind('/')); }
};

struct bare_bluetooth_linux_char_value_event_t {
  std::string path;
  std::vector<uint8_t> value;
};

struct bare_bluetooth_linux_device_props_changed_event_t {
  std::string path;
  std::optional<bool> connected;
  std::optional<bool> paired;
  std::optional<bool> services_resolved;
  std::optional<int32_t> rssi;
  std::optional<std::string> name;
};

struct bare_bluetooth_linux_tsfn_ctx_t {
  bare_bluetooth_linux_adapter_t *adapter;
};

struct bare_bluetooth_linux_async_call_t {
  js_env_t *env;
  js_persistent_t<js_function_t<void, js_object_t>> cb;
  bare_bluetooth_linux_adapter_t *adapter;
  std::optional<std::string> error;
};

struct bare_bluetooth_linux_async_read_call_t {
  js_env_t *env;
  js_persistent_t<js_function_t<void, js_object_t, js_arraybuffer_t>> cb;
  bare_bluetooth_linux_adapter_t *adapter;
  std::optional<std::string> error;
  std::vector<uint8_t> data;
};

static void
bare_bluetooth_linux__noop(js_env_t *env, js_receiver_t) {}

using bare_bluetooth_linux__noop_fn =
  js_function_t<void, js_receiver_t>;

using bare_bluetooth_linux__on_device_added_fn =
  js_function_t<void, js_receiver_t, std::string, std::string>;

using bare_bluetooth_linux__on_device_removed_fn =
  js_function_t<void, js_receiver_t, std::string>;

using bare_bluetooth_linux__on_service_added_fn =
  js_function_t<void, js_receiver_t, std::string, std::string, std::string>;

using bare_bluetooth_linux__on_service_removed_fn =
  js_function_t<void, js_receiver_t, std::string, std::string>;

using bare_bluetooth_linux__on_char_added_fn =
  js_function_t<void, js_receiver_t, std::string, std::string, std::string>;

using bare_bluetooth_linux__on_char_removed_fn =
  js_function_t<void, js_receiver_t, std::string, std::string>;

using bare_bluetooth_linux__on_desc_added_fn =
  js_function_t<void, js_receiver_t, std::string, std::string, std::string>;

using bare_bluetooth_linux__on_desc_removed_fn =
  js_function_t<void, js_receiver_t, std::string, std::string>;

using bare_bluetooth_linux__on_char_value_fn =
  js_function_t<void, js_receiver_t, std::string, js_arraybuffer_t>;

using bare_bluetooth_linux__on_device_props_changed_fn =
  js_function_t<void, js_receiver_t, std::string, std::optional<bool>, std::optional<bool>, std::optional<bool>, std::optional<int32_t>, std::optional<std::string>>;

using bare_bluetooth_linux__on_adv_released_fn =
  js_function_t<void, js_receiver_t>;

struct bare_bluetooth_linux_adv_released_event_t {};

struct bare_bluetooth_linux_advertisement_t {
  std::string type;
  std::optional<std::string> local_name;
  std::vector<std::string> service_uuids;
};

struct bare_bluetooth_linux_local_characteristic_t {
  std::string uuid;
  std::vector<std::string> flags;
  std::vector<uint8_t> value;
  std::string path;
  std::string service_path;
};

struct bare_bluetooth_linux_local_service_t {
  std::string uuid;
  bool primary;
  std::string path;
  std::vector<bare_bluetooth_linux_local_characteristic_t> characteristics;
};

struct bare_bluetooth_linux_gatt_app_t {
  std::string path;
  std::vector<bare_bluetooth_linux_local_service_t> services;
  std::unordered_map<std::string, bare_bluetooth_linux_local_service_t *> service_map;
  std::unordered_map<std::string, bare_bluetooth_linux_local_characteristic_t *> characteristic_map;
};

struct bare_bluetooth_linux_gatt_characteristic_write_event_t {
  std::string path;
  std::vector<uint8_t> value;
};

using bare_bluetooth_linux__on_gatt_characteristic_write_fn =
  js_function_t<void, js_receiver_t, std::string, js_arraybuffer_t>;

struct bare_bluetooth_linux_adapter_t {
  DBusConnection *conn;
  DBusConnection *signal_conn;
  std::string adapter_path;
  std::atomic<bool> running;
  std::atomic<int> tsfn_count;
  uv_thread_t thread;
  uv_async_t cleanup_async;
  js_ref_t *ctx;
  js_threadsafe_function_t *tsfn_device_added;
  js_threadsafe_function_t *tsfn_device_removed;
  js_threadsafe_function_t *tsfn_method_reply;
  js_threadsafe_function_t *tsfn_read_reply;
  js_threadsafe_function_t *tsfn_service_added;
  js_threadsafe_function_t *tsfn_service_removed;
  js_threadsafe_function_t *tsfn_char_added;
  js_threadsafe_function_t *tsfn_char_removed;
  js_threadsafe_function_t *tsfn_desc_added;
  js_threadsafe_function_t *tsfn_desc_removed;
  js_threadsafe_function_t *tsfn_char_value;
  js_threadsafe_function_t *tsfn_device_props_changed;
  js_threadsafe_function_t *tsfn_adv_released;
  js_threadsafe_function_t *tsfn_gatt_characteristic_write;
  bare_bluetooth_linux_advertisement_t adv;
  bare_bluetooth_linux_gatt_app_t gatt_app;
};

static void
bare_bluetooth_linux__on_device_added(
  js_env_t *env,
  bare_bluetooth_linux__on_device_added_fn function,
  bare_bluetooth_linux_tsfn_ctx_t *ctx,
  bare_bluetooth_linux_device_added_event_t *event
) {
  int err;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *receiver;
  err = js_get_reference_value(env, ctx->adapter->ctx, &receiver);
  assert(err == 0);

  js_call_function(env, function, js_receiver_t(receiver), event->path, event->address);

  delete event;

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_bluetooth_linux__on_device_removed(
  js_env_t *env,
  bare_bluetooth_linux__on_device_removed_fn function,
  bare_bluetooth_linux_tsfn_ctx_t *ctx,
  bare_bluetooth_linux_device_removed_event_t *event
) {
  int err;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *receiver;
  err = js_get_reference_value(env, ctx->adapter->ctx, &receiver);
  assert(err == 0);

  js_call_function(env, function, js_receiver_t(receiver), event->path);

  delete event;

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_bluetooth_linux__on_service_added(
  js_env_t *env,
  bare_bluetooth_linux__on_service_added_fn function,
  bare_bluetooth_linux_tsfn_ctx_t *ctx,
  bare_bluetooth_linux_service_added_event_t *event
) {
  int err;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *receiver;
  err = js_get_reference_value(env, ctx->adapter->ctx, &receiver);
  assert(err == 0);

  js_call_function(env, function, js_receiver_t(receiver), event->path, event->device_path(), event->uuid);

  delete event;

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_bluetooth_linux__on_service_removed(
  js_env_t *env,
  bare_bluetooth_linux__on_service_removed_fn function,
  bare_bluetooth_linux_tsfn_ctx_t *ctx,
  bare_bluetooth_linux_service_removed_event_t *event
) {
  int err;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *receiver;
  err = js_get_reference_value(env, ctx->adapter->ctx, &receiver);
  assert(err == 0);

  js_call_function(env, function, js_receiver_t(receiver), event->path, event->device_path());

  delete event;

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_bluetooth_linux__on_char_added(
  js_env_t *env,
  bare_bluetooth_linux__on_char_added_fn function,
  bare_bluetooth_linux_tsfn_ctx_t *ctx,
  bare_bluetooth_linux_char_added_event_t *event
) {
  int err;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *receiver;
  err = js_get_reference_value(env, ctx->adapter->ctx, &receiver);
  assert(err == 0);

  js_call_function(env, function, js_receiver_t(receiver), event->path, event->service_path(), event->uuid);

  delete event;

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_bluetooth_linux__on_char_removed(
  js_env_t *env,
  bare_bluetooth_linux__on_char_removed_fn function,
  bare_bluetooth_linux_tsfn_ctx_t *ctx,
  bare_bluetooth_linux_char_removed_event_t *event
) {
  int err;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *receiver;
  err = js_get_reference_value(env, ctx->adapter->ctx, &receiver);
  assert(err == 0);

  js_call_function(env, function, js_receiver_t(receiver), event->path, event->service_path());

  delete event;

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_bluetooth_linux__on_desc_added(
  js_env_t *env,
  bare_bluetooth_linux__on_desc_added_fn function,
  bare_bluetooth_linux_tsfn_ctx_t *ctx,
  bare_bluetooth_linux_desc_added_event_t *event
) {
  int err;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *receiver;
  err = js_get_reference_value(env, ctx->adapter->ctx, &receiver);
  assert(err == 0);

  js_call_function(env, function, js_receiver_t(receiver), event->path, event->char_path(), event->uuid);

  delete event;

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_bluetooth_linux__on_desc_removed(
  js_env_t *env,
  bare_bluetooth_linux__on_desc_removed_fn function,
  bare_bluetooth_linux_tsfn_ctx_t *ctx,
  bare_bluetooth_linux_desc_removed_event_t *event
) {
  int err;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *receiver;
  err = js_get_reference_value(env, ctx->adapter->ctx, &receiver);
  assert(err == 0);

  js_call_function(env, function, js_receiver_t(receiver), event->path, event->char_path());

  delete event;

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_bluetooth_linux__on_char_value(
  js_env_t *env,
  bare_bluetooth_linux__on_char_value_fn function,
  bare_bluetooth_linux_tsfn_ctx_t *ctx,
  bare_bluetooth_linux_char_value_event_t *event
) {
  int err;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *receiver;
  err = js_get_reference_value(env, ctx->adapter->ctx, &receiver);
  assert(err == 0);

  js_arraybuffer_t buffer;
  err = js_create_arraybuffer(env, event->value, buffer);
  assert(err == 0);

  js_call_function(env, function, js_receiver_t(receiver), event->path, buffer);

  delete event;

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_bluetooth_linux__on_device_props_changed(
  js_env_t *env,
  bare_bluetooth_linux__on_device_props_changed_fn function,
  bare_bluetooth_linux_tsfn_ctx_t *ctx,
  bare_bluetooth_linux_device_props_changed_event_t *event
) {
  int err;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *receiver;
  err = js_get_reference_value(env, ctx->adapter->ctx, &receiver);
  assert(err == 0);

  js_call_function(env, function, js_receiver_t(receiver), event->path, event->connected, event->paired, event->services_resolved, event->rssi, event->name);

  delete event;

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_bluetooth_linux__on_adv_released(
  js_env_t *env,
  bare_bluetooth_linux__on_adv_released_fn function,
  bare_bluetooth_linux_tsfn_ctx_t *ctx,
  bare_bluetooth_linux_adv_released_event_t *event
) {
  int err;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *receiver;
  err = js_get_reference_value(env, ctx->adapter->ctx, &receiver);
  assert(err == 0);

  js_call_function(env, function, js_receiver_t(receiver));

  delete event;

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_bluetooth_linux__on_gatt_characteristic_write(
  js_env_t *env,
  bare_bluetooth_linux__on_gatt_characteristic_write_fn function,
  bare_bluetooth_linux_tsfn_ctx_t *ctx,
  bare_bluetooth_linux_gatt_characteristic_write_event_t *event
) {
  int err;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *receiver;
  err = js_get_reference_value(env, ctx->adapter->ctx, &receiver);
  assert(err == 0);

  js_arraybuffer_t buffer;
  err = js_create_arraybuffer(env, event->value, buffer);
  assert(err == 0);

  js_call_function(env, function, js_receiver_t(receiver), event->path, buffer);

  delete event;

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

#define DBUS_EXTRACT_ERROR(reply, target) \
  if (dbus_message_get_type(reply) == DBUS_MESSAGE_TYPE_ERROR) { \
    DBusError _err; \
    dbus_error_init(&_err); \
    dbus_set_error_from_message(&_err, reply); \
    (target) = std::string(_err.message); \
    dbus_error_free(&_err); \
  }

static void
bare_bluetooth_linux__on_gatt_unregister_notify(DBusPendingCall *pending, void *data) {
  auto *call = static_cast<bare_bluetooth_linux_async_call_t *>(data);

  DBusMessage *reply = dbus_pending_call_steal_reply(pending);
  DBUS_EXTRACT_ERROR(reply, call->error);

  dbus_message_unref(reply);
  dbus_pending_call_unref(pending);

  auto *adapter = call->adapter;
  if (!adapter->gatt_app.path.empty()) {
    dbus_connection_unregister_object_path(adapter->signal_conn, adapter->gatt_app.path.c_str());
    adapter->gatt_app.path.clear();
    adapter->gatt_app.services.clear();
    adapter->gatt_app.service_map.clear();
    adapter->gatt_app.characteristic_map.clear();
  }

  js_call_threadsafe_function(adapter->tsfn_method_reply, call, js_threadsafe_function_nonblocking);
}

static void
bare_bluetooth_linux__on_pending_call_notify(DBusPendingCall *pending, void *data) {
  auto *call = static_cast<bare_bluetooth_linux_async_call_t *>(data);

  DBusMessage *reply = dbus_pending_call_steal_reply(pending);
  DBUS_EXTRACT_ERROR(reply, call->error);

  dbus_message_unref(reply);
  dbus_pending_call_unref(pending);

  js_call_threadsafe_function(call->adapter->tsfn_method_reply, call, js_threadsafe_function_nonblocking);
}

static void
bare_bluetooth_linux__on_method_reply(
  js_env_t *env,
  bare_bluetooth_linux__noop_fn function,
  bare_bluetooth_linux_tsfn_ctx_t *ctx,
  bare_bluetooth_linux_async_call_t *call
) {
  int err;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_function_t<void, js_object_t> callback;
  err = js_get_reference_value(env, call->cb, callback);
  assert(err == 0);

  js_object_t error;

  if (call->error) {
    err = js_create_error(env, call->error->c_str(), error);
    assert(err == 0);
  } else {
    err = js_get_null(env, error);
    assert(err == 0);
  }

  err = js_call_function_with_checkpoint(env, callback, error);
  assert(err != js_pending_exception);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);

  delete call;
}

static void
bare_bluetooth_linux__on_pending_read_call_notify(DBusPendingCall *pending, void *data) {
  auto *call = static_cast<bare_bluetooth_linux_async_read_call_t *>(data);

  DBusMessage *reply = dbus_pending_call_steal_reply(pending);
  DBUS_EXTRACT_ERROR(reply, call->error);

  if (!call->error) {
    DBusMessageIter reply_iter;
    dbus_message_iter_init(reply, &reply_iter);

    if (dbus_message_iter_get_arg_type(&reply_iter) == DBUS_TYPE_ARRAY) {
      DBusMessageIter array_iter;
      dbus_message_iter_recurse(&reply_iter, &array_iter);

      const uint8_t *bytes;
      int len;
      dbus_message_iter_get_fixed_array(&array_iter, &bytes, &len);
      call->data.assign(bytes, bytes + len);
    }
  }

  dbus_message_unref(reply);
  dbus_pending_call_unref(pending);

  js_call_threadsafe_function(call->adapter->tsfn_read_reply, call, js_threadsafe_function_nonblocking);
}

static void
bare_bluetooth_linux__on_read_reply(
  js_env_t *env,
  bare_bluetooth_linux__noop_fn function,
  bare_bluetooth_linux_tsfn_ctx_t *ctx,
  bare_bluetooth_linux_async_read_call_t *call
) {
  int err;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_function_t<void, js_object_t, js_arraybuffer_t> callback;
  err = js_get_reference_value(env, call->cb, callback);
  assert(err == 0);

  js_object_t error;

  if (call->error) {
    err = js_create_error(env, call->error->c_str(), error);
    assert(err == 0);
  } else {
    err = js_get_null(env, error);
    assert(err == 0);
  }

  js_arraybuffer_t buffer;
  err = js_create_arraybuffer(env, call->data, buffer);
  assert(err == 0);

  err = js_call_function_with_checkpoint(env, callback, error, buffer);
  assert(err != js_pending_exception);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);

  delete call;
}

static void
bare_bluetooth_linux__on_tsfn_finalize(js_env_t *env, bare_bluetooth_linux_tsfn_ctx_t *ctx) {
  auto *adapter = ctx->adapter;
  delete ctx;

  if (adapter->tsfn_count.fetch_sub(1) > 1) return;

  int err = js_delete_reference(env, adapter->ctx);
  assert(err == 0);

  dbus_connection_close(adapter->signal_conn);
  dbus_connection_unref(adapter->signal_conn);

  dbus_connection_close(adapter->conn);
  dbus_connection_unref(adapter->conn);

  adapter->conn = nullptr;
  adapter->signal_conn = nullptr;

  adapter->~bare_bluetooth_linux_adapter_t();
}

static void
bare_bluetooth_linux__on_interfaces_added(bare_bluetooth_linux_adapter_t *adapter, DBusMessage *msg) {
  DBusMessageIter args;
  if (!dbus_message_iter_init(msg, &args)) return;

  const char *obj_path;
  dbus_message_iter_get_basic(&args, &obj_path);
  dbus_message_iter_next(&args);

  if (strncmp(obj_path, adapter->adapter_path.c_str(), adapter->adapter_path.length()) != 0)
    return;

  DBusMessageIter ifaces_iter;
  dbus_message_iter_recurse(&args, &ifaces_iter);

  bool is_device = false;
  std::string address;

  bool is_service = false;
  std::string service_uuid;

  bool is_char = false;
  std::string char_uuid;

  bool is_desc = false;
  std::string desc_uuid;

  while (dbus_message_iter_get_arg_type(&ifaces_iter) == DBUS_TYPE_DICT_ENTRY) {
    DBusMessageIter entry;
    dbus_message_iter_recurse(&ifaces_iter, &entry);

    const char *iface_name;
    dbus_message_iter_get_basic(&entry, &iface_name);

    if (strcmp(iface_name, BLUEZ_DEVICE_IFACE) == 0) {
      dbus_message_iter_next(&entry);
      DBusMessageIter props_iter;
      dbus_message_iter_recurse(&entry, &props_iter);
      auto addr = dbus_find_string_in_props(&props_iter, "Address");
      if (addr) {
        is_device = true;
        address = *addr;
      }

    } else if (strcmp(iface_name, BLUEZ_GATT_SERVICE_IFACE) == 0) {
      dbus_message_iter_next(&entry);
      DBusMessageIter props_iter;
      dbus_message_iter_recurse(&entry, &props_iter);
      auto svc_uuid = dbus_find_string_in_props(&props_iter, "UUID");
      if (svc_uuid) {
        is_service = true;
        service_uuid = *svc_uuid;
      }

    } else if (strcmp(iface_name, BLUEZ_GATT_CHAR_IFACE) == 0) {
      dbus_message_iter_next(&entry);
      DBusMessageIter props_iter;
      dbus_message_iter_recurse(&entry, &props_iter);
      auto cuuid = dbus_find_string_in_props(&props_iter, "UUID");
      if (cuuid) {
        is_char = true;
        char_uuid = *cuuid;
      }

    } else if (strcmp(iface_name, BLUEZ_GATT_DESC_IFACE) == 0) {
      dbus_message_iter_next(&entry);
      DBusMessageIter props_iter;
      dbus_message_iter_recurse(&entry, &props_iter);
      auto duuid = dbus_find_string_in_props(&props_iter, "UUID");
      if (duuid) {
        is_desc = true;
        desc_uuid = *duuid;
      }
    }

    dbus_message_iter_next(&ifaces_iter);
  }

  if (is_device && !address.empty()) {
    auto *event = new bare_bluetooth_linux_device_added_event_t;
    event->path = obj_path;
    event->address = address;
    js_call_threadsafe_function(adapter->tsfn_device_added, event, js_threadsafe_function_nonblocking);
  }

  if (is_service && !service_uuid.empty()) {
    auto *event = new bare_bluetooth_linux_service_added_event_t;
    event->path = obj_path;
    event->uuid = service_uuid;
    js_call_threadsafe_function(adapter->tsfn_service_added, event, js_threadsafe_function_nonblocking);
  }

  if (is_char && !char_uuid.empty()) {
    auto *event = new bare_bluetooth_linux_char_added_event_t;
    event->path = obj_path;
    event->uuid = char_uuid;
    js_call_threadsafe_function(adapter->tsfn_char_added, event, js_threadsafe_function_nonblocking);
  }

  if (is_desc && !desc_uuid.empty()) {
    auto *event = new bare_bluetooth_linux_desc_added_event_t;
    event->path = obj_path;
    event->uuid = desc_uuid;
    js_call_threadsafe_function(adapter->tsfn_desc_added, event, js_threadsafe_function_nonblocking);
  }
}

static void
bare_bluetooth_linux__on_interfaces_removed(bare_bluetooth_linux_adapter_t *adapter, DBusMessage *msg) {
  DBusMessageIter args;
  if (!dbus_message_iter_init(msg, &args)) return;

  const char *obj_path;
  dbus_message_iter_get_basic(&args, &obj_path);
  dbus_message_iter_next(&args);

  if (strncmp(obj_path, adapter->adapter_path.c_str(), adapter->adapter_path.length()) != 0)
    return;

  DBusMessageIter ifaces_iter;
  dbus_message_iter_recurse(&args, &ifaces_iter);

  bool is_device = false;
  bool is_service = false;
  bool is_char = false;
  bool is_desc = false;

  while (dbus_message_iter_get_arg_type(&ifaces_iter) == DBUS_TYPE_STRING) {
    const char *iface_name;
    dbus_message_iter_get_basic(&ifaces_iter, &iface_name);
    if (strcmp(iface_name, BLUEZ_DEVICE_IFACE) == 0) {
      is_device = true;
    } else if (strcmp(iface_name, BLUEZ_GATT_SERVICE_IFACE) == 0) {
      is_service = true;
    } else if (strcmp(iface_name, BLUEZ_GATT_CHAR_IFACE) == 0) {
      is_char = true;
    } else if (strcmp(iface_name, BLUEZ_GATT_DESC_IFACE) == 0) {
      is_desc = true;
    }
    dbus_message_iter_next(&ifaces_iter);
  }

  if (is_device) {
    auto *event = new bare_bluetooth_linux_device_removed_event_t;
    event->path = obj_path;
    js_call_threadsafe_function(adapter->tsfn_device_removed, event, js_threadsafe_function_nonblocking);
  }

  if (is_service) {
    auto *event = new bare_bluetooth_linux_service_removed_event_t;
    event->path = obj_path;
    js_call_threadsafe_function(adapter->tsfn_service_removed, event, js_threadsafe_function_nonblocking);
  }

  if (is_char) {
    auto *event = new bare_bluetooth_linux_char_removed_event_t;
    event->path = obj_path;
    js_call_threadsafe_function(adapter->tsfn_char_removed, event, js_threadsafe_function_nonblocking);
  }

  if (is_desc) {
    auto *event = new bare_bluetooth_linux_desc_removed_event_t;
    event->path = obj_path;
    js_call_threadsafe_function(adapter->tsfn_desc_removed, event, js_threadsafe_function_nonblocking);
  }
}

static void
bare_bluetooth_linux__on_device_props_changed_signal(bare_bluetooth_linux_adapter_t *adapter, const char *obj_path, DBusMessageIter *props_iter) {
  auto *event = new bare_bluetooth_linux_device_props_changed_event_t;
  event->path = obj_path;
  bool has_changes = false;

  while (dbus_message_iter_get_arg_type(props_iter) == DBUS_TYPE_DICT_ENTRY) {
    DBusMessageIter entry;
    dbus_message_iter_recurse(props_iter, &entry);

    const char *prop_name;
    dbus_message_iter_get_basic(&entry, &prop_name);
    dbus_message_iter_next(&entry);

    DBusMessageIter variant;
    dbus_message_iter_recurse(&entry, &variant);

    if (strcmp(prop_name, "Connected") == 0 && dbus_message_iter_get_arg_type(&variant) == DBUS_TYPE_BOOLEAN) {
      dbus_bool_t val;
      dbus_message_iter_get_basic(&variant, &val);
      event->connected = val;
      has_changes = true;
    } else if (strcmp(prop_name, "Paired") == 0 && dbus_message_iter_get_arg_type(&variant) == DBUS_TYPE_BOOLEAN) {
      dbus_bool_t val;
      dbus_message_iter_get_basic(&variant, &val);
      event->paired = val;
      has_changes = true;
    } else if (strcmp(prop_name, "ServicesResolved") == 0 && dbus_message_iter_get_arg_type(&variant) == DBUS_TYPE_BOOLEAN) {
      dbus_bool_t val;
      dbus_message_iter_get_basic(&variant, &val);
      event->services_resolved = val;
      has_changes = true;
    } else if (strcmp(prop_name, "RSSI") == 0 && dbus_message_iter_get_arg_type(&variant) == DBUS_TYPE_INT16) {
      int16_t val;
      dbus_message_iter_get_basic(&variant, &val);
      event->rssi = val;
      has_changes = true;
    } else if (strcmp(prop_name, "Name") == 0 && dbus_message_iter_get_arg_type(&variant) == DBUS_TYPE_STRING) {
      const char *val;
      dbus_message_iter_get_basic(&variant, &val);
      event->name = val;
      has_changes = true;
    }

    dbus_message_iter_next(props_iter);
  }

  if (has_changes) {
    js_call_threadsafe_function(adapter->tsfn_device_props_changed, event, js_threadsafe_function_nonblocking);
  } else {
    // No tracked properties changed; free the event since it won't be consumed by the tsfn callback
    delete event;
  }
}

static void
bare_bluetooth_linux__on_char_value_changed_signal(bare_bluetooth_linux_adapter_t *adapter, const char *obj_path, DBusMessageIter *props_iter) {
  while (dbus_message_iter_get_arg_type(props_iter) == DBUS_TYPE_DICT_ENTRY) {
    DBusMessageIter entry;
    dbus_message_iter_recurse(props_iter, &entry);

    const char *prop_name;
    dbus_message_iter_get_basic(&entry, &prop_name);

    if (strcmp(prop_name, "Value") == 0) {
      dbus_message_iter_next(&entry);
      DBusMessageIter variant;
      dbus_message_iter_recurse(&entry, &variant);

      if (dbus_message_iter_get_arg_type(&variant) == DBUS_TYPE_ARRAY) {
        DBusMessageIter array_iter;
        dbus_message_iter_recurse(&variant, &array_iter);

        const uint8_t *data;
        int len;
        dbus_message_iter_get_fixed_array(&array_iter, &data, &len);

        auto *event = new bare_bluetooth_linux_char_value_event_t;
        event->path = obj_path;
        event->value.assign(data, data + len);
        js_call_threadsafe_function(adapter->tsfn_char_value, event, js_threadsafe_function_nonblocking);
      }
      break;
    }

    dbus_message_iter_next(props_iter);
  }
}

static DBusHandlerResult
bare_bluetooth_linux__advertisement_message_handler(
  DBusConnection *conn, DBusMessage *msg, void *user_data
) {
  auto *adapter = static_cast<bare_bluetooth_linux_adapter_t *>(user_data);

  if (dbus_message_is_method_call(msg, DBUS_PROP_IFACE, "GetAll")) {
    DBusMessage *reply = dbus_message_new_method_return(msg);
    DBusMessageIter iter, dict;
    dbus_message_iter_init_append(reply, &iter);
    dbus_message_iter_open_container(&iter, DBUS_TYPE_ARRAY, "{sv}", &dict);

    dbus_dict_append_string(&dict, "Type", adapter->adv.type.c_str());

    if (adapter->adv.local_name) {
      dbus_dict_append_string(&dict, "LocalName", adapter->adv.local_name->c_str());
    }

    if (!adapter->adv.service_uuids.empty()) {
      dbus_dict_append_string_array(&dict, "ServiceUUIDs", adapter->adv.service_uuids);
    }

    dbus_message_iter_close_container(&iter, &dict);
    dbus_connection_send(conn, reply, nullptr);
    dbus_message_unref(reply);
    return DBUS_HANDLER_RESULT_HANDLED;
  }

  if (dbus_message_is_method_call(msg, BLUEZ_LE_ADV_IFACE, "Release")) {
    DBusMessage *reply = dbus_message_new_method_return(msg);
    dbus_connection_send(conn, reply, nullptr);
    dbus_message_unref(reply);

    auto *event = new bare_bluetooth_linux_adv_released_event_t;
    js_call_threadsafe_function(adapter->tsfn_adv_released, event, js_threadsafe_function_nonblocking);
    return DBUS_HANDLER_RESULT_HANDLED;
  }

  return DBUS_HANDLER_RESULT_NOT_YET_HANDLED;
}

static DBusObjectPathVTable bare_bluetooth_linux__adv_vtable = {
  nullptr,
  bare_bluetooth_linux__advertisement_message_handler
};

static void
dbus_dict_append_bool(DBusMessageIter *dict, const char *key, dbus_bool_t val) {
  DBusMessageIter entry, variant;
  dbus_message_iter_open_container(dict, DBUS_TYPE_DICT_ENTRY, nullptr, &entry);
  dbus_message_iter_append_basic(&entry, DBUS_TYPE_STRING, &key);
  dbus_message_iter_open_container(&entry, DBUS_TYPE_VARIANT, "b", &variant);
  dbus_message_iter_append_basic(&variant, DBUS_TYPE_BOOLEAN, &val);
  dbus_message_iter_close_container(&entry, &variant);
  dbus_message_iter_close_container(dict, &entry);
}

static void
dbus_dict_append_object_path(DBusMessageIter *dict, const char *key, const char *val) {
  DBusMessageIter entry, variant;
  dbus_message_iter_open_container(dict, DBUS_TYPE_DICT_ENTRY, nullptr, &entry);
  dbus_message_iter_append_basic(&entry, DBUS_TYPE_STRING, &key);
  dbus_message_iter_open_container(&entry, DBUS_TYPE_VARIANT, "o", &variant);
  dbus_message_iter_append_basic(&variant, DBUS_TYPE_OBJECT_PATH, &val);
  dbus_message_iter_close_container(&entry, &variant);
  dbus_message_iter_close_container(dict, &entry);
}

static void
dbus_dict_append_byte_array(DBusMessageIter *dict, const char *key, const std::vector<uint8_t> &data) {
  DBusMessageIter entry, variant, array;
  dbus_message_iter_open_container(dict, DBUS_TYPE_DICT_ENTRY, nullptr, &entry);
  dbus_message_iter_append_basic(&entry, DBUS_TYPE_STRING, &key);
  dbus_message_iter_open_container(&entry, DBUS_TYPE_VARIANT, "ay", &variant);
  dbus_message_iter_open_container(&variant, DBUS_TYPE_ARRAY, "y", &array);
  for (const auto &b : data) {
    dbus_message_iter_append_basic(&array, DBUS_TYPE_BYTE, &b);
  }
  dbus_message_iter_close_container(&variant, &array);
  dbus_message_iter_close_container(&entry, &variant);
  dbus_message_iter_close_container(dict, &entry);
}

static void
bare_bluetooth_linux__gatt_append_service_props(DBusMessageIter *dict, const bare_bluetooth_linux_local_service_t &svc, const char *uuid_key, const char *primary_key) {
  dbus_dict_append_string(dict, uuid_key, svc.uuid.c_str());
  dbus_bool_t primary = svc.primary ? TRUE : FALSE;
  dbus_dict_append_bool(dict, primary_key, primary);
}

static void
bare_bluetooth_linux__gatt_append_characteristic_props(DBusMessageIter *dict, const bare_bluetooth_linux_local_characteristic_t &ch, const char *uuid_key, const char *service_key, const char *flags_key, const char *value_key) {
  dbus_dict_append_string(dict, uuid_key, ch.uuid.c_str());
  dbus_dict_append_object_path(dict, service_key, ch.service_path.c_str());
  dbus_dict_append_string_array(dict, flags_key, ch.flags);
  dbus_dict_append_byte_array(dict, value_key, ch.value);
}

static DBusHandlerResult
bare_bluetooth_linux__gatt_message_handler(
  DBusConnection *conn, DBusMessage *msg, void *user_data
) {
  auto *adapter = static_cast<bare_bluetooth_linux_adapter_t *>(user_data);
  const char *path = dbus_message_get_path(msg);

  if (dbus_message_is_method_call(msg, DBUS_OM_IFACE, "GetManagedObjects")) {
    DBusMessage *reply = dbus_message_new_method_return(msg);
    DBusMessageIter iter, outer;
    dbus_message_iter_init_append(reply, &iter);
    dbus_message_iter_open_container(&iter, DBUS_TYPE_ARRAY, "{oa{sa{sv}}}", &outer);

    for (const auto &svc : adapter->gatt_app.services) {
      DBusMessageIter obj_entry, ifaces_dict, iface_entry, props_dict;
      const char *svc_path = svc.path.c_str();

      dbus_message_iter_open_container(&outer, DBUS_TYPE_DICT_ENTRY, nullptr, &obj_entry);
      dbus_message_iter_append_basic(&obj_entry, DBUS_TYPE_OBJECT_PATH, &svc_path);
      dbus_message_iter_open_container(&obj_entry, DBUS_TYPE_ARRAY, "{sa{sv}}", &ifaces_dict);

      const char *svc_iface = BLUEZ_GATT_SERVICE_IFACE;
      dbus_message_iter_open_container(&ifaces_dict, DBUS_TYPE_DICT_ENTRY, nullptr, &iface_entry);
      dbus_message_iter_append_basic(&iface_entry, DBUS_TYPE_STRING, &svc_iface);
      dbus_message_iter_open_container(&iface_entry, DBUS_TYPE_ARRAY, "{sv}", &props_dict);
      bare_bluetooth_linux__gatt_append_service_props(&props_dict, svc, "UUID", "Primary");
      dbus_message_iter_close_container(&iface_entry, &props_dict);
      dbus_message_iter_close_container(&ifaces_dict, &iface_entry);

      dbus_message_iter_close_container(&obj_entry, &ifaces_dict);
      dbus_message_iter_close_container(&outer, &obj_entry);

      for (const auto &ch : svc.characteristics) {
        DBusMessageIter ch_obj_entry, ch_ifaces_dict, ch_iface_entry, ch_props_dict;
        const char *ch_path = ch.path.c_str();

        dbus_message_iter_open_container(&outer, DBUS_TYPE_DICT_ENTRY, nullptr, &ch_obj_entry);
        dbus_message_iter_append_basic(&ch_obj_entry, DBUS_TYPE_OBJECT_PATH, &ch_path);
        dbus_message_iter_open_container(&ch_obj_entry, DBUS_TYPE_ARRAY, "{sa{sv}}", &ch_ifaces_dict);

        const char *ch_iface = BLUEZ_GATT_CHAR_IFACE;
        dbus_message_iter_open_container(&ch_ifaces_dict, DBUS_TYPE_DICT_ENTRY, nullptr, &ch_iface_entry);
        dbus_message_iter_append_basic(&ch_iface_entry, DBUS_TYPE_STRING, &ch_iface);
        dbus_message_iter_open_container(&ch_iface_entry, DBUS_TYPE_ARRAY, "{sv}", &ch_props_dict);
        bare_bluetooth_linux__gatt_append_characteristic_props(&ch_props_dict, ch, "UUID", "Service", "Flags", "Value");
        dbus_message_iter_close_container(&ch_iface_entry, &ch_props_dict);
        dbus_message_iter_close_container(&ch_ifaces_dict, &ch_iface_entry);

        dbus_message_iter_close_container(&ch_obj_entry, &ch_ifaces_dict);
        dbus_message_iter_close_container(&outer, &ch_obj_entry);
      }
    }

    dbus_message_iter_close_container(&iter, &outer);
    dbus_connection_send(conn, reply, nullptr);
    dbus_message_unref(reply);
    return DBUS_HANDLER_RESULT_HANDLED;
  }

  if (dbus_message_is_method_call(msg, DBUS_PROP_IFACE, "GetAll")) {
    auto svc_it = adapter->gatt_app.service_map.find(path);
    if (svc_it != adapter->gatt_app.service_map.end()) {
      DBusMessage *reply = dbus_message_new_method_return(msg);
      DBusMessageIter iter, dict;
      dbus_message_iter_init_append(reply, &iter);
      dbus_message_iter_open_container(&iter, DBUS_TYPE_ARRAY, "{sv}", &dict);
      bare_bluetooth_linux__gatt_append_service_props(&dict, *svc_it->second, "UUID", "Primary");
      dbus_message_iter_close_container(&iter, &dict);
      dbus_connection_send(conn, reply, nullptr);
      dbus_message_unref(reply);
      return DBUS_HANDLER_RESULT_HANDLED;
    }

    auto ch_it = adapter->gatt_app.characteristic_map.find(path);
    if (ch_it != adapter->gatt_app.characteristic_map.end()) {
      DBusMessage *reply = dbus_message_new_method_return(msg);
      DBusMessageIter iter, dict;
      dbus_message_iter_init_append(reply, &iter);
      dbus_message_iter_open_container(&iter, DBUS_TYPE_ARRAY, "{sv}", &dict);
      bare_bluetooth_linux__gatt_append_characteristic_props(&dict, *ch_it->second, "UUID", "Service", "Flags", "Value");
      dbus_message_iter_close_container(&iter, &dict);
      dbus_connection_send(conn, reply, nullptr);
      dbus_message_unref(reply);
      return DBUS_HANDLER_RESULT_HANDLED;
    }

    return DBUS_HANDLER_RESULT_NOT_YET_HANDLED;
  }

  if (dbus_message_is_method_call(msg, BLUEZ_GATT_CHAR_IFACE, "ReadValue")) {
    auto it = adapter->gatt_app.characteristic_map.find(path);
    if (it != adapter->gatt_app.characteristic_map.end()) {
      auto &ch = *it->second;
      DBusMessage *reply = dbus_message_new_method_return(msg);
      DBusMessageIter iter, array;
      dbus_message_iter_init_append(reply, &iter);
      dbus_message_iter_open_container(&iter, DBUS_TYPE_ARRAY, "y", &array);
      for (const auto &b : ch.value) {
        dbus_message_iter_append_basic(&array, DBUS_TYPE_BYTE, &b);
      }
      dbus_message_iter_close_container(&iter, &array);
      dbus_connection_send(conn, reply, nullptr);
      dbus_message_unref(reply);
      return DBUS_HANDLER_RESULT_HANDLED;
    }
    return DBUS_HANDLER_RESULT_NOT_YET_HANDLED;
  }

  if (dbus_message_is_method_call(msg, BLUEZ_GATT_CHAR_IFACE, "WriteValue")) {
    auto it = adapter->gatt_app.characteristic_map.find(path);
    if (it != adapter->gatt_app.characteristic_map.end()) {
      auto &ch = *it->second;
      DBusMessageIter args;
      if (!dbus_message_iter_init(msg, &args) || dbus_message_iter_get_arg_type(&args) != DBUS_TYPE_ARRAY) {
        DBusMessage *error = dbus_message_new_error(msg, "org.bluez.Error.InvalidArguments", "Expected byte array");
        dbus_connection_send(conn, error, nullptr);
        dbus_message_unref(error);
        return DBUS_HANDLER_RESULT_HANDLED;
      }

      DBusMessageIter array_iter;
      dbus_message_iter_recurse(&args, &array_iter);

      const uint8_t *bytes;
      int len;
      dbus_message_iter_get_fixed_array(&array_iter, &bytes, &len);
      ch.value.assign(bytes, bytes + len);

      auto *event = new bare_bluetooth_linux_gatt_characteristic_write_event_t;
      event->path = path;
      event->value.assign(bytes, bytes + len);
      js_call_threadsafe_function(adapter->tsfn_gatt_characteristic_write, event, js_threadsafe_function_nonblocking);

      DBusMessage *reply = dbus_message_new_method_return(msg);
      dbus_connection_send(conn, reply, nullptr);
      dbus_message_unref(reply);
      return DBUS_HANDLER_RESULT_HANDLED;
    }
    return DBUS_HANDLER_RESULT_NOT_YET_HANDLED;
  }

  return DBUS_HANDLER_RESULT_NOT_YET_HANDLED;
}

static DBusObjectPathVTable bare_bluetooth_linux__gatt_vtable = {
  nullptr,
  bare_bluetooth_linux__gatt_message_handler
};

static DBusHandlerResult
bare_bluetooth_linux__signal_filter(DBusConnection *conn, DBusMessage *msg, void *data) {
  auto *adapter = static_cast<bare_bluetooth_linux_adapter_t *>(data);

  if (!adapter->running.load())
    return DBUS_HANDLER_RESULT_NOT_YET_HANDLED;

  if (dbus_message_is_signal(msg, DBUS_OM_IFACE, "InterfacesAdded")) {
    bare_bluetooth_linux__on_interfaces_added(adapter, msg);
    return DBUS_HANDLER_RESULT_HANDLED;
  }

  if (dbus_message_is_signal(msg, DBUS_OM_IFACE, "InterfacesRemoved")) {
    bare_bluetooth_linux__on_interfaces_removed(adapter, msg);
    return DBUS_HANDLER_RESULT_HANDLED;
  }

  if (dbus_message_is_signal(msg, DBUS_PROP_IFACE, "PropertiesChanged")) {
    const char *obj_path = dbus_message_get_path(msg);
    if (!obj_path || strncmp(obj_path, adapter->adapter_path.c_str(), adapter->adapter_path.length()) != 0)
      return DBUS_HANDLER_RESULT_NOT_YET_HANDLED;

    DBusMessageIter args;
    if (!dbus_message_iter_init(msg, &args))
      return DBUS_HANDLER_RESULT_NOT_YET_HANDLED;

    const char *iface_name;
    dbus_message_iter_get_basic(&args, &iface_name);
    dbus_message_iter_next(&args);

    DBusMessageIter props_iter;
    dbus_message_iter_recurse(&args, &props_iter);

    if (strcmp(iface_name, BLUEZ_DEVICE_IFACE) == 0) {
      bare_bluetooth_linux__on_device_props_changed_signal(adapter, obj_path, &props_iter);
      return DBUS_HANDLER_RESULT_HANDLED;
    }

    if (strcmp(iface_name, BLUEZ_GATT_CHAR_IFACE) == 0) {
      bare_bluetooth_linux__on_char_value_changed_signal(adapter, obj_path, &props_iter);
      return DBUS_HANDLER_RESULT_HANDLED;
    }

    return DBUS_HANDLER_RESULT_NOT_YET_HANDLED;
  }

  return DBUS_HANDLER_RESULT_NOT_YET_HANDLED;
}

static void
bare_bluetooth_linux__on_cleanup_close(uv_handle_t *handle) {
  (void) handle;
}

static void
bare_bluetooth_linux__on_cleanup(uv_async_t *async) {
  auto *adapter = static_cast<bare_bluetooth_linux_adapter_t *>(async->data);

  uv_thread_join(&adapter->thread);

  int err;

  err = js_release_threadsafe_function(adapter->tsfn_device_added, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(adapter->tsfn_device_removed, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(adapter->tsfn_method_reply, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(adapter->tsfn_read_reply, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(adapter->tsfn_service_added, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(adapter->tsfn_service_removed, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(adapter->tsfn_char_added, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(adapter->tsfn_char_removed, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(adapter->tsfn_desc_added, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(adapter->tsfn_desc_removed, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(adapter->tsfn_char_value, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(adapter->tsfn_device_props_changed, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(adapter->tsfn_adv_released, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(adapter->tsfn_gatt_characteristic_write, js_threadsafe_function_release);
  assert(err == 0);

  uv_close(reinterpret_cast<uv_handle_t *>(async), bare_bluetooth_linux__on_cleanup_close);
}

static void
bare_bluetooth_linux__dbus_thread(void *data) {
  auto *adapter = static_cast<bare_bluetooth_linux_adapter_t *>(data);

  while (adapter->running.load()) {
    if (!dbus_connection_read_write_dispatch(adapter->signal_conn, DBUS_POLL_INTERVAL)) break;
  }

  uv_async_send(&adapter->cleanup_async);
}

static js_arraybuffer_t
bare_bluetooth_linux_adapter_init(
  js_env_t *env,
  js_receiver_t,
  std::string path,
  js_object_t context,
  bare_bluetooth_linux__on_device_added_fn on_device_added,
  bare_bluetooth_linux__on_device_removed_fn on_device_removed,
  bare_bluetooth_linux__on_service_added_fn on_service_added,
  bare_bluetooth_linux__on_service_removed_fn on_service_removed,
  bare_bluetooth_linux__on_char_added_fn on_char_added,
  bare_bluetooth_linux__on_char_removed_fn on_char_removed,
  bare_bluetooth_linux__on_desc_added_fn on_desc_added,
  bare_bluetooth_linux__on_desc_removed_fn on_desc_removed,
  bare_bluetooth_linux__on_char_value_fn on_char_value,
  bare_bluetooth_linux__on_device_props_changed_fn on_device_props_changed,
  bare_bluetooth_linux__on_adv_released_fn on_adv_released,
  bare_bluetooth_linux__on_gatt_characteristic_write_fn on_gatt_characteristic_write
) {
  dbus_threads_init_default();

  js_arraybuffer_t handle;
  bare_bluetooth_linux_adapter_t *adapter;
  int err = js_create_arraybuffer(env, adapter, handle);
  assert(err == 0);

  new (adapter) bare_bluetooth_linux_adapter_t();

  adapter->adapter_path = path;
  adapter->running.store(true);
  adapter->tsfn_count.store(14);

  err = js_create_reference(env, static_cast<js_value_t *>(context), 1, &adapter->ctx);
  assert(err == 0);

  uv_loop_t *loop;
  err = js_get_env_loop(env, &loop);
  assert(err == 0);

  err = uv_async_init(loop, &adapter->cleanup_async, bare_bluetooth_linux__on_cleanup);
  assert(err == 0);

  adapter->cleanup_async.data = adapter;

  DBusError dbus_err;

  // TODO: handle D-Bus errors and throw to JS
  dbus_error_init(&dbus_err);
  adapter->conn = dbus_bus_get_private(DBUS_BUS_SYSTEM, &dbus_err);
  assert(!dbus_error_is_set(&dbus_err));
  dbus_connection_set_exit_on_disconnect(adapter->conn, FALSE);

  // TODO: handle D-Bus errors and throw to JS
  dbus_error_init(&dbus_err);
  adapter->signal_conn = dbus_bus_get_private(DBUS_BUS_SYSTEM, &dbus_err);
  assert(!dbus_error_is_set(&dbus_err));
  dbus_connection_set_exit_on_disconnect(adapter->signal_conn, FALSE);

  dbus_bus_add_match(
    adapter->signal_conn,
    "type='signal',sender='org.bluez',interface='org.freedesktop.DBus.ObjectManager',member='InterfacesAdded'",
    nullptr
  );
  dbus_bus_add_match(
    adapter->signal_conn,
    "type='signal',sender='org.bluez',interface='org.freedesktop.DBus.ObjectManager',member='InterfacesRemoved'",
    nullptr
  );
  dbus_bus_add_match(
    adapter->signal_conn,
    "type='signal',sender='org.bluez',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged'",
    nullptr
  );
  dbus_connection_flush(adapter->signal_conn);

  dbus_connection_add_filter(adapter->signal_conn, bare_bluetooth_linux__signal_filter, adapter, nullptr);

  auto *added_ctx = new bare_bluetooth_linux_tsfn_ctx_t{adapter};
  err = js_create_threadsafe_function<
    bare_bluetooth_linux__on_device_added,
    bare_bluetooth_linux__on_tsfn_finalize,
    bare_bluetooth_linux_tsfn_ctx_t,
    bare_bluetooth_linux_device_added_event_t>(env, on_device_added, 0, 1, added_ctx, adapter->tsfn_device_added);
  assert(err == 0);

  auto *removed_ctx = new bare_bluetooth_linux_tsfn_ctx_t{adapter};
  err = js_create_threadsafe_function<
    bare_bluetooth_linux__on_device_removed,
    bare_bluetooth_linux__on_tsfn_finalize,
    bare_bluetooth_linux_tsfn_ctx_t,
    bare_bluetooth_linux_device_removed_event_t>(env, on_device_removed, 0, 1, removed_ctx, adapter->tsfn_device_removed);
  assert(err == 0);

  bare_bluetooth_linux__noop_fn noop;
  err = js_create_function<bare_bluetooth_linux__noop>(env, noop);
  assert(err == 0);

  auto *reply_ctx = new bare_bluetooth_linux_tsfn_ctx_t{adapter};
  err = js_create_threadsafe_function<
    bare_bluetooth_linux__on_method_reply,
    bare_bluetooth_linux__on_tsfn_finalize,
    bare_bluetooth_linux_tsfn_ctx_t,
    bare_bluetooth_linux_async_call_t>(env, noop, 0, 1, reply_ctx, adapter->tsfn_method_reply);
  assert(err == 0);

  auto *read_reply_ctx = new bare_bluetooth_linux_tsfn_ctx_t{adapter};
  err = js_create_threadsafe_function<
    bare_bluetooth_linux__on_read_reply,
    bare_bluetooth_linux__on_tsfn_finalize,
    bare_bluetooth_linux_tsfn_ctx_t,
    bare_bluetooth_linux_async_read_call_t>(env, noop, 0, 1, read_reply_ctx, adapter->tsfn_read_reply);
  assert(err == 0);

  auto *service_added_ctx = new bare_bluetooth_linux_tsfn_ctx_t{adapter};
  err = js_create_threadsafe_function<
    bare_bluetooth_linux__on_service_added,
    bare_bluetooth_linux__on_tsfn_finalize,
    bare_bluetooth_linux_tsfn_ctx_t,
    bare_bluetooth_linux_service_added_event_t>(env, on_service_added, 0, 1, service_added_ctx, adapter->tsfn_service_added);
  assert(err == 0);

  auto *service_removed_ctx = new bare_bluetooth_linux_tsfn_ctx_t{adapter};
  err = js_create_threadsafe_function<
    bare_bluetooth_linux__on_service_removed,
    bare_bluetooth_linux__on_tsfn_finalize,
    bare_bluetooth_linux_tsfn_ctx_t,
    bare_bluetooth_linux_service_removed_event_t>(env, on_service_removed, 0, 1, service_removed_ctx, adapter->tsfn_service_removed);
  assert(err == 0);

  auto *char_added_ctx = new bare_bluetooth_linux_tsfn_ctx_t{adapter};
  err = js_create_threadsafe_function<
    bare_bluetooth_linux__on_char_added,
    bare_bluetooth_linux__on_tsfn_finalize,
    bare_bluetooth_linux_tsfn_ctx_t,
    bare_bluetooth_linux_char_added_event_t>(env, on_char_added, 0, 1, char_added_ctx, adapter->tsfn_char_added);
  assert(err == 0);

  auto *char_removed_ctx = new bare_bluetooth_linux_tsfn_ctx_t{adapter};
  err = js_create_threadsafe_function<
    bare_bluetooth_linux__on_char_removed,
    bare_bluetooth_linux__on_tsfn_finalize,
    bare_bluetooth_linux_tsfn_ctx_t,
    bare_bluetooth_linux_char_removed_event_t>(env, on_char_removed, 0, 1, char_removed_ctx, adapter->tsfn_char_removed);
  assert(err == 0);

  auto *desc_added_ctx = new bare_bluetooth_linux_tsfn_ctx_t{adapter};
  err = js_create_threadsafe_function<
    bare_bluetooth_linux__on_desc_added,
    bare_bluetooth_linux__on_tsfn_finalize,
    bare_bluetooth_linux_tsfn_ctx_t,
    bare_bluetooth_linux_desc_added_event_t>(env, on_desc_added, 0, 1, desc_added_ctx, adapter->tsfn_desc_added);
  assert(err == 0);

  auto *desc_removed_ctx = new bare_bluetooth_linux_tsfn_ctx_t{adapter};
  err = js_create_threadsafe_function<
    bare_bluetooth_linux__on_desc_removed,
    bare_bluetooth_linux__on_tsfn_finalize,
    bare_bluetooth_linux_tsfn_ctx_t,
    bare_bluetooth_linux_desc_removed_event_t>(env, on_desc_removed, 0, 1, desc_removed_ctx, adapter->tsfn_desc_removed);
  assert(err == 0);

  auto *char_value_ctx = new bare_bluetooth_linux_tsfn_ctx_t{adapter};
  err = js_create_threadsafe_function<
    bare_bluetooth_linux__on_char_value,
    bare_bluetooth_linux__on_tsfn_finalize,
    bare_bluetooth_linux_tsfn_ctx_t,
    bare_bluetooth_linux_char_value_event_t>(env, on_char_value, 0, 1, char_value_ctx, adapter->tsfn_char_value);
  assert(err == 0);

  auto *device_props_ctx = new bare_bluetooth_linux_tsfn_ctx_t{adapter};
  err = js_create_threadsafe_function<
    bare_bluetooth_linux__on_device_props_changed,
    bare_bluetooth_linux__on_tsfn_finalize,
    bare_bluetooth_linux_tsfn_ctx_t,
    bare_bluetooth_linux_device_props_changed_event_t>(env, on_device_props_changed, 0, 1, device_props_ctx, adapter->tsfn_device_props_changed);
  assert(err == 0);

  auto *adv_released_ctx = new bare_bluetooth_linux_tsfn_ctx_t{adapter};
  err = js_create_threadsafe_function<
    bare_bluetooth_linux__on_adv_released,
    bare_bluetooth_linux__on_tsfn_finalize,
    bare_bluetooth_linux_tsfn_ctx_t,
    bare_bluetooth_linux_adv_released_event_t>(env, on_adv_released, 0, 1, adv_released_ctx, adapter->tsfn_adv_released);
  assert(err == 0);

  auto *gatt_characteristic_write_ctx = new bare_bluetooth_linux_tsfn_ctx_t{adapter};
  err = js_create_threadsafe_function<
    bare_bluetooth_linux__on_gatt_characteristic_write,
    bare_bluetooth_linux__on_tsfn_finalize,
    bare_bluetooth_linux_tsfn_ctx_t,
    bare_bluetooth_linux_gatt_characteristic_write_event_t>(env, on_gatt_characteristic_write, 0, 1, gatt_characteristic_write_ctx, adapter->tsfn_gatt_characteristic_write);
  assert(err == 0);

  uv_thread_create(&adapter->thread, bare_bluetooth_linux__dbus_thread, adapter);

  return handle;
}

static void
bare_bluetooth_linux_adapter_destroy(
  js_env_t *env,
  js_receiver_t,
  js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter
) {
  if (!adapter->running.load()) return;

  adapter->running.store(false);
}

static bool
bare_bluetooth_linux_adapter_get_powered(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter
) {
  return dbus_get_bool_prop(adapter->conn, adapter->adapter_path.c_str(), BLUEZ_ADAPTER_IFACE, "Powered");
}

static void
bare_bluetooth_linux_adapter_set_powered(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, bool value
) {
  dbus_set_bool_prop(adapter->conn, adapter->adapter_path.c_str(), BLUEZ_ADAPTER_IFACE, "Powered", value);
}

static bool
bare_bluetooth_linux_adapter_get_discovering(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter
) {
  return dbus_get_bool_prop(adapter->conn, adapter->adapter_path.c_str(), BLUEZ_ADAPTER_IFACE, "Discovering");
}

static std::optional<std::string>
bare_bluetooth_linux_adapter_get_address(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter
) {
  return dbus_get_string_prop(adapter->conn, adapter->adapter_path.c_str(), BLUEZ_ADAPTER_IFACE, "Address");
}

static void
bare_bluetooth_linux_adapter_set_discovery_filter(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::vector<std::string> uuids, std::optional<int32_t> rssi, std::optional<std::string> transport
) {
  DBusMessage *msg =
    dbus_message_new_method_call(BLUEZ_BUS, adapter->adapter_path.c_str(), BLUEZ_ADAPTER_IFACE, "SetDiscoveryFilter");

  DBusMessageIter iter, dict;
  dbus_message_iter_init_append(msg, &iter);
  dbus_message_iter_open_container(&iter, DBUS_TYPE_ARRAY, "{sv}", &dict);

  if (!uuids.empty()) dbus_dict_append_string_array(&dict, "UUIDs", uuids);
  if (rssi) dbus_dict_append_int16(&dict, "RSSI", static_cast<int16_t>(*rssi));
  if (transport) dbus_dict_append_string(&dict, "Transport", transport->c_str());

  dbus_message_iter_close_container(&iter, &dict);

  DBusError dbus_err;
  dbus_error_init(&dbus_err);
  DBusMessage *reply =
    dbus_connection_send_with_reply_and_block(adapter->conn, msg, DBUS_TIMEOUT, &dbus_err);
  dbus_message_unref(msg);

  if (reply) dbus_message_unref(reply);

  if (dbus_error_is_set(&dbus_err)) {
    int err = js_throw_error(env, nullptr, dbus_err.message);
    assert(err == 0);
    dbus_error_free(&dbus_err);
  }
}

static void
bare_bluetooth_linux_adapter_start_discovery(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter
) {
  auto error = dbus_call_void_method_sync(adapter->conn, adapter->adapter_path.c_str(), BLUEZ_ADAPTER_IFACE, "StartDiscovery");
  if (error) {
    int err = js_throw_error(env, nullptr, error->c_str());
    assert(err == 0);
  }
}

static void
bare_bluetooth_linux_adapter_stop_discovery(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter
) {
  auto error = dbus_call_void_method_sync(adapter->conn, adapter->adapter_path.c_str(), BLUEZ_ADAPTER_IFACE, "StopDiscovery");
  if (error) {
    int err = js_throw_error(env, nullptr, error->c_str());
    assert(err == 0);
  }
}

static std::optional<std::string>
bare_bluetooth_linux_device_get_address(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path
) {
  return dbus_get_string_prop(adapter->conn, path.c_str(), BLUEZ_DEVICE_IFACE, "Address");
}

static std::optional<std::string>
bare_bluetooth_linux_device_get_name(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path
) {
  return dbus_get_string_prop(adapter->conn, path.c_str(), BLUEZ_DEVICE_IFACE, "Name");
}

static std::optional<int32_t>
bare_bluetooth_linux_device_get_rssi(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path
) {
  return dbus_get_numeric_prop<int16_t>(adapter->conn, path.c_str(), BLUEZ_DEVICE_IFACE, "RSSI");
}

static bool
bare_bluetooth_linux_device_get_paired(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path
) {
  return dbus_get_bool_prop(adapter->conn, path.c_str(), BLUEZ_DEVICE_IFACE, "Paired");
}

static bool
bare_bluetooth_linux_device_get_connected(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path
) {
  return dbus_get_bool_prop(adapter->conn, path.c_str(), BLUEZ_DEVICE_IFACE, "Connected");
}

static bool
bare_bluetooth_linux_device_get_services_resolved(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path
) {
  return dbus_get_bool_prop(adapter->conn, path.c_str(), BLUEZ_DEVICE_IFACE, "ServicesResolved");
}

static std::vector<std::string>
bare_bluetooth_linux_device_get_uuids(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path
) {
  return dbus_get_string_array_prop(adapter->conn, path.c_str(), BLUEZ_DEVICE_IFACE, "UUIDs");
}

static void
bare_bluetooth_linux_device_get_manufacturer_data(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path, js_object_t result
) {
  int err;

  DBusMessage *msg =
    dbus_message_new_method_call(BLUEZ_BUS, path.c_str(), DBUS_PROP_IFACE, "Get");
  const char *iface = BLUEZ_DEVICE_IFACE;
  const char *prop = "ManufacturerData";
  dbus_message_append_args(msg, DBUS_TYPE_STRING, &iface, DBUS_TYPE_STRING, &prop, DBUS_TYPE_INVALID);

  DBusError dbus_err;
  dbus_error_init(&dbus_err);
  DBusMessage *reply =
    dbus_connection_send_with_reply_and_block(adapter->conn, msg, DBUS_TIMEOUT, &dbus_err);
  dbus_message_unref(msg);

  if (!reply || dbus_error_is_set(&dbus_err)) {
    if (dbus_error_is_set(&dbus_err)) dbus_error_free(&dbus_err);
    return;
  }

  DBusMessageIter iter, variant, dict;
  dbus_message_iter_init(reply, &iter);
  dbus_message_iter_recurse(&iter, &variant);

  if (dbus_message_iter_get_arg_type(&variant) == DBUS_TYPE_ARRAY) {
    dbus_message_iter_recurse(&variant, &dict);

    while (dbus_message_iter_get_arg_type(&dict) == DBUS_TYPE_DICT_ENTRY) {
      DBusMessageIter entry;
      dbus_message_iter_recurse(&dict, &entry);

      uint16_t company_id;
      dbus_message_iter_get_basic(&entry, &company_id);
      dbus_message_iter_next(&entry);

      DBusMessageIter val_variant;
      dbus_message_iter_recurse(&entry, &val_variant);

      if (dbus_message_iter_get_arg_type(&val_variant) == DBUS_TYPE_ARRAY) {
        DBusMessageIter array_iter;
        dbus_message_iter_recurse(&val_variant, &array_iter);

        const uint8_t *bytes;
        int len;
        dbus_message_iter_get_fixed_array(&array_iter, &bytes, &len);

        if (len > 0) {
          js_value_t *buffer;
          void *data;
          err = js_create_arraybuffer(env, len, &data, &buffer);
          assert(err == 0);
          memcpy(data, bytes, len);

          char key[16];
          snprintf(key, sizeof(key), "%u", company_id);
          err = js_set_named_property(env, static_cast<js_value_t *>(result), key, buffer);
          assert(err == 0);
        }
      }

      dbus_message_iter_next(&dict);
    }
  }

  dbus_message_unref(reply);
}

static void
bare_bluetooth_linux_device_get_service_data(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path, js_object_t result
) {
  int err;

  DBusMessage *msg =
    dbus_message_new_method_call(BLUEZ_BUS, path.c_str(), DBUS_PROP_IFACE, "Get");
  const char *iface = BLUEZ_DEVICE_IFACE;
  const char *prop = "ServiceData";
  dbus_message_append_args(msg, DBUS_TYPE_STRING, &iface, DBUS_TYPE_STRING, &prop, DBUS_TYPE_INVALID);

  DBusError dbus_err;
  dbus_error_init(&dbus_err);
  DBusMessage *reply =
    dbus_connection_send_with_reply_and_block(adapter->conn, msg, DBUS_TIMEOUT, &dbus_err);
  dbus_message_unref(msg);

  if (!reply || dbus_error_is_set(&dbus_err)) {
    if (dbus_error_is_set(&dbus_err)) dbus_error_free(&dbus_err);
    return;
  }

  DBusMessageIter iter, variant, dict;
  dbus_message_iter_init(reply, &iter);
  dbus_message_iter_recurse(&iter, &variant);

  if (dbus_message_iter_get_arg_type(&variant) == DBUS_TYPE_ARRAY) {
    dbus_message_iter_recurse(&variant, &dict);

    while (dbus_message_iter_get_arg_type(&dict) == DBUS_TYPE_DICT_ENTRY) {
      DBusMessageIter entry;
      dbus_message_iter_recurse(&dict, &entry);

      const char *uuid;
      dbus_message_iter_get_basic(&entry, &uuid);
      dbus_message_iter_next(&entry);

      DBusMessageIter val_variant;
      dbus_message_iter_recurse(&entry, &val_variant);

      if (dbus_message_iter_get_arg_type(&val_variant) == DBUS_TYPE_ARRAY) {
        DBusMessageIter array_iter;
        dbus_message_iter_recurse(&val_variant, &array_iter);

        const uint8_t *bytes;
        int len;
        dbus_message_iter_get_fixed_array(&array_iter, &bytes, &len);

        if (len > 0) {
          js_value_t *buffer;
          void *data;
          err = js_create_arraybuffer(env, len, &data, &buffer);
          assert(err == 0);
          memcpy(data, bytes, len);

          err = js_set_named_property(env, static_cast<js_value_t *>(result), uuid, buffer);
          assert(err == 0);
        }
      }

      dbus_message_iter_next(&dict);
    }
  }

  dbus_message_unref(reply);
}

static void
bare_bluetooth_linux__call_method_async(
  js_env_t *env,
  js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter,
  std::string path,
  const char *iface,
  std::string method,
  int timeout,
  js_function_t<void, js_object_t> callback
) {
  auto *call = new bare_bluetooth_linux_async_call_t();
  call->env = env;
  call->adapter = &*adapter;

  int err;
  err = js_create_reference(env, callback, call->cb);
  assert(err == 0);

  DBusPendingCall *pending = dbus_call_void_method(adapter->signal_conn, path.c_str(), iface, method.c_str(), timeout);

  dbus_pending_call_set_notify(pending, bare_bluetooth_linux__on_pending_call_notify, call, NULL);
}

static void
bare_bluetooth_linux_device_connect(
  js_env_t *env,
  js_receiver_t,
  js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter,
  std::string path,
  js_function_t<void, js_object_t> callback
) {
  bare_bluetooth_linux__call_method_async(env, adapter, path, BLUEZ_DEVICE_IFACE, "Connect", DBUS_CONNECT_TIMEOUT, callback);
}

static void
bare_bluetooth_linux_device_disconnect(
  js_env_t *env,
  js_receiver_t,
  js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter,
  std::string path,
  js_function_t<void, js_object_t> callback
) {
  bare_bluetooth_linux__call_method_async(env, adapter, path, BLUEZ_DEVICE_IFACE, "Disconnect", DBUS_CONNECT_TIMEOUT, callback);
}

static void
bare_bluetooth_linux_device_pair(
  js_env_t *env,
  js_receiver_t,
  js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter,
  std::string path,
  js_function_t<void, js_object_t> callback
) {
  bare_bluetooth_linux__call_method_async(env, adapter, path, BLUEZ_DEVICE_IFACE, "Pair", DBUS_CONNECT_TIMEOUT, callback);
}

static bool
bare_bluetooth_linux_service_is_primary(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path
) {
  return dbus_get_bool_prop(adapter->conn, path.c_str(), BLUEZ_GATT_SERVICE_IFACE, "Primary");
}

static void
bare_bluetooth_linux_char_read(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path, js_function_t<void, js_object_t, js_arraybuffer_t> callback
) {
  auto *call = new bare_bluetooth_linux_async_read_call_t();
  call->env = env;
  call->adapter = &*adapter;

  int err;
  err = js_create_reference(env, callback, call->cb);
  assert(err == 0);

  DBusMessage *msg =
    dbus_message_new_method_call(BLUEZ_BUS, path.c_str(), BLUEZ_GATT_CHAR_IFACE, "ReadValue");

  DBusMessageIter iter, dict;
  dbus_message_iter_init_append(msg, &iter);
  dbus_message_iter_open_container(&iter, DBUS_TYPE_ARRAY, "{sv}", &dict);
  dbus_message_iter_close_container(&iter, &dict);

  DBusPendingCall *pending;
  dbus_connection_send_with_reply(adapter->signal_conn, msg, &pending, DBUS_TIMEOUT);
  dbus_message_unref(msg);

  dbus_pending_call_set_notify(pending, bare_bluetooth_linux__on_pending_read_call_notify, call, NULL);
}

static void
bare_bluetooth_linux_char_write(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path, js_typedarray_t<uint8_t> value, std::optional<std::string> type, js_function_t<void, js_object_t> callback
) {
  auto *call = new bare_bluetooth_linux_async_call_t();
  call->env = env;
  call->adapter = &*adapter;

  int err;
  err = js_create_reference(env, callback, call->cb);
  assert(err == 0);

  uint8_t *data;
  size_t len;
  err = js_get_typedarray_info(env, value, data, len);
  assert(err == 0);

  DBusMessage *msg =
    dbus_message_new_method_call(BLUEZ_BUS, path.c_str(), BLUEZ_GATT_CHAR_IFACE, "WriteValue");

  DBusMessageIter iter, array, dict;
  dbus_message_iter_init_append(msg, &iter);

  dbus_message_iter_open_container(&iter, DBUS_TYPE_ARRAY, "y", &array);
  for (size_t i = 0; i < len; i++) {
    dbus_message_iter_append_basic(&array, DBUS_TYPE_BYTE, &data[i]);
  }
  dbus_message_iter_close_container(&iter, &array);

  dbus_message_iter_open_container(&iter, DBUS_TYPE_ARRAY, "{sv}", &dict);

  if (type) dbus_dict_append_string(&dict, "type", type->c_str());

  dbus_message_iter_close_container(&iter, &dict);

  DBusPendingCall *pending;
  dbus_connection_send_with_reply(adapter->signal_conn, msg, &pending, DBUS_TIMEOUT);
  dbus_message_unref(msg);

  dbus_pending_call_set_notify(pending, bare_bluetooth_linux__on_pending_call_notify, call, NULL);
}

static void
bare_bluetooth_linux_char_start_notify(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path, js_function_t<void, js_object_t> callback
) {
  bare_bluetooth_linux__call_method_async(env, adapter, path, BLUEZ_GATT_CHAR_IFACE, "StartNotify", DBUS_TIMEOUT, callback);
}

static void
bare_bluetooth_linux_char_stop_notify(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path, js_function_t<void, js_object_t> callback
) {
  bare_bluetooth_linux__call_method_async(env, adapter, path, BLUEZ_GATT_CHAR_IFACE, "StopNotify", DBUS_TIMEOUT, callback);
}

static std::vector<std::string>
bare_bluetooth_linux_char_get_flags(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path
) {
  return dbus_get_string_array_prop(adapter->conn, path.c_str(), BLUEZ_GATT_CHAR_IFACE, "Flags");
}

static std::optional<int32_t>
bare_bluetooth_linux_char_get_mtu(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path
) {
  return dbus_get_numeric_prop<uint16_t>(adapter->conn, path.c_str(), BLUEZ_GATT_CHAR_IFACE, "MTU");
}

static void
bare_bluetooth_linux_desc_read(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path, js_function_t<void, js_object_t, js_arraybuffer_t> callback
) {
  auto *call = new bare_bluetooth_linux_async_read_call_t();
  call->env = env;
  call->adapter = &*adapter;

  int err;
  err = js_create_reference(env, callback, call->cb);
  assert(err == 0);

  DBusMessage *msg =
    dbus_message_new_method_call(BLUEZ_BUS, path.c_str(), BLUEZ_GATT_DESC_IFACE, "ReadValue");

  DBusMessageIter iter, dict;
  dbus_message_iter_init_append(msg, &iter);
  dbus_message_iter_open_container(&iter, DBUS_TYPE_ARRAY, "{sv}", &dict);
  dbus_message_iter_close_container(&iter, &dict);

  DBusPendingCall *pending;
  dbus_connection_send_with_reply(adapter->signal_conn, msg, &pending, DBUS_TIMEOUT);
  dbus_message_unref(msg);

  dbus_pending_call_set_notify(pending, bare_bluetooth_linux__on_pending_read_call_notify, call, NULL);
}

static void
bare_bluetooth_linux_desc_write(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path, js_typedarray_t<uint8_t> value, js_function_t<void, js_object_t> callback
) {
  auto *call = new bare_bluetooth_linux_async_call_t();
  call->env = env;
  call->adapter = &*adapter;

  int err;
  err = js_create_reference(env, callback, call->cb);
  assert(err == 0);

  uint8_t *data;
  size_t len;
  err = js_get_typedarray_info(env, value, data, len);
  assert(err == 0);

  DBusMessage *msg =
    dbus_message_new_method_call(BLUEZ_BUS, path.c_str(), BLUEZ_GATT_DESC_IFACE, "WriteValue");

  DBusMessageIter iter, array, dict;
  dbus_message_iter_init_append(msg, &iter);

  dbus_message_iter_open_container(&iter, DBUS_TYPE_ARRAY, "y", &array);
  for (size_t i = 0; i < len; i++) {
    dbus_message_iter_append_basic(&array, DBUS_TYPE_BYTE, &data[i]);
  }
  dbus_message_iter_close_container(&iter, &array);

  dbus_message_iter_open_container(&iter, DBUS_TYPE_ARRAY, "{sv}", &dict);
  dbus_message_iter_close_container(&iter, &dict);

  DBusPendingCall *pending;
  dbus_connection_send_with_reply(adapter->signal_conn, msg, &pending, DBUS_TIMEOUT);
  dbus_message_unref(msg);

  dbus_pending_call_set_notify(pending, bare_bluetooth_linux__on_pending_call_notify, call, NULL);
}

static std::vector<std::string>
bare_bluetooth_linux_desc_get_flags(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string path
) {
  return dbus_get_string_array_prop(adapter->conn, path.c_str(), BLUEZ_GATT_DESC_IFACE, "Flags");
}

static void
bare_bluetooth_linux_advertisement_register(
  js_env_t *env,
  js_receiver_t,
  js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter,
  std::string type,
  std::vector<std::string> service_uuids,
  std::optional<std::string> local_name,
  js_function_t<void, js_object_t> callback
) {
  adapter->adv.type = type;
  adapter->adv.service_uuids = service_uuids;
  adapter->adv.local_name = local_name;

  dbus_connection_register_object_path(
    adapter->signal_conn, BLUEZ_ADV_PATH, &bare_bluetooth_linux__adv_vtable, &*adapter
  );

  auto *call = new bare_bluetooth_linux_async_call_t();
  call->env = env;
  call->adapter = &*adapter;

  int err;
  err = js_create_reference(env, callback, call->cb);
  assert(err == 0);

  DBusMessage *msg = dbus_message_new_method_call(
    BLUEZ_BUS, adapter->adapter_path.c_str(), BLUEZ_LE_ADV_MGR_IFACE, "RegisterAdvertisement"
  );

  const char *adv_path = BLUEZ_ADV_PATH;
  DBusMessageIter iter, dict;
  dbus_message_iter_init_append(msg, &iter);
  dbus_message_iter_append_basic(&iter, DBUS_TYPE_OBJECT_PATH, &adv_path);
  dbus_message_iter_open_container(&iter, DBUS_TYPE_ARRAY, "{sv}", &dict);
  dbus_message_iter_close_container(&iter, &dict);

  DBusPendingCall *pending;
  dbus_connection_send_with_reply(adapter->signal_conn, msg, &pending, DBUS_TIMEOUT);
  dbus_message_unref(msg);

  dbus_pending_call_set_notify(pending, bare_bluetooth_linux__on_pending_call_notify, call, NULL);
}

static void
bare_bluetooth_linux_advertisement_unregister(
  js_env_t *env,
  js_receiver_t,
  js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter,
  js_function_t<void, js_object_t> callback
) {
  auto *call = new bare_bluetooth_linux_async_call_t();
  call->env = env;
  call->adapter = &*adapter;

  int err;
  err = js_create_reference(env, callback, call->cb);
  assert(err == 0);

  DBusMessage *msg = dbus_message_new_method_call(
    BLUEZ_BUS, adapter->adapter_path.c_str(), BLUEZ_LE_ADV_MGR_IFACE, "UnregisterAdvertisement"
  );

  const char *adv_path = BLUEZ_ADV_PATH;
  DBusMessageIter iter;
  dbus_message_iter_init_append(msg, &iter);
  dbus_message_iter_append_basic(&iter, DBUS_TYPE_OBJECT_PATH, &adv_path);

  DBusPendingCall *pending;
  dbus_connection_send_with_reply(adapter->signal_conn, msg, &pending, DBUS_TIMEOUT);
  dbus_message_unref(msg);

  dbus_connection_unregister_object_path(adapter->signal_conn, BLUEZ_ADV_PATH);

  dbus_pending_call_set_notify(pending, bare_bluetooth_linux__on_pending_call_notify, call, NULL);
}

static int32_t
bare_bluetooth_linux_gatt_service_add(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string app_path, std::string uuid, bool primary
) {
  if (adapter->gatt_app.path.empty()) {
    adapter->gatt_app.path = app_path;
  } else if (adapter->gatt_app.path != app_path) {
    js_throw_error(env, nullptr, "All services must share the same application path");
    return -1;
  }

  bare_bluetooth_linux_local_service_t svc;
  svc.uuid = uuid;
  svc.primary = primary;
  int32_t idx = static_cast<int32_t>(adapter->gatt_app.services.size());
  svc.path = app_path + "/service" + std::to_string(idx);
  adapter->gatt_app.services.push_back(std::move(svc));
  adapter->gatt_app.service_map[adapter->gatt_app.services.back().path] = &adapter->gatt_app.services.back();
  return idx;
}

static std::optional<std::string>
bare_bluetooth_linux_gatt_characteristic_add(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, int32_t service_index, std::string uuid, std::vector<std::string> flags, js_typedarray_t<uint8_t> value
) {
  if (service_index < 0 || service_index >= static_cast<int32_t>(adapter->gatt_app.services.size())) {
    js_throw_error(env, nullptr, "service_index out of bounds");
    return std::nullopt;
  }

  auto &svc = adapter->gatt_app.services[service_index];

  bare_bluetooth_linux_local_characteristic_t ch;
  ch.uuid = uuid;
  ch.flags = flags;
  ch.service_path = svc.path;

  uint8_t *data;
  size_t len;
  int err = js_get_typedarray_info(env, value, data, len);
  assert(err == 0);
  ch.value.assign(data, data + len);

  int32_t idx = static_cast<int32_t>(svc.characteristics.size());
  ch.path = svc.path + "/char" + std::to_string(idx);
  svc.characteristics.push_back(std::move(ch));
  adapter->gatt_app.characteristic_map[svc.characteristics.back().path] = &svc.characteristics.back();
  return svc.characteristics.back().path;
}

static void
bare_bluetooth_linux_gatt_register(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, js_function_t<void, js_object_t> callback
) {
  dbus_connection_register_fallback(
    adapter->signal_conn, adapter->gatt_app.path.c_str(), &bare_bluetooth_linux__gatt_vtable, &*adapter
  );

  auto *call = new bare_bluetooth_linux_async_call_t();
  call->env = env;
  call->adapter = &*adapter;

  int err;
  err = js_create_reference(env, callback, call->cb);
  assert(err == 0);

  DBusMessage *msg = dbus_message_new_method_call(
    BLUEZ_BUS, adapter->adapter_path.c_str(), BLUEZ_GATT_MGR_IFACE, "RegisterApplication"
  );

  const char *app_path = adapter->gatt_app.path.c_str();
  DBusMessageIter iter, dict;
  dbus_message_iter_init_append(msg, &iter);
  dbus_message_iter_append_basic(&iter, DBUS_TYPE_OBJECT_PATH, &app_path);
  dbus_message_iter_open_container(&iter, DBUS_TYPE_ARRAY, "{sv}", &dict);
  dbus_message_iter_close_container(&iter, &dict);

  DBusPendingCall *pending;
  dbus_connection_send_with_reply(adapter->signal_conn, msg, &pending, DBUS_TIMEOUT);
  dbus_message_unref(msg);

  dbus_pending_call_set_notify(pending, bare_bluetooth_linux__on_pending_call_notify, call, NULL);
}

static void
bare_bluetooth_linux_gatt_unregister(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, js_function_t<void, js_object_t> callback
) {
  auto *call = new bare_bluetooth_linux_async_call_t();
  call->env = env;
  call->adapter = &*adapter;

  int err;
  err = js_create_reference(env, callback, call->cb);
  assert(err == 0);

  DBusMessage *msg = dbus_message_new_method_call(
    BLUEZ_BUS, adapter->adapter_path.c_str(), BLUEZ_GATT_MGR_IFACE, "UnregisterApplication"
  );

  const char *app_path = adapter->gatt_app.path.c_str();
  DBusMessageIter iter;
  dbus_message_iter_init_append(msg, &iter);
  dbus_message_iter_append_basic(&iter, DBUS_TYPE_OBJECT_PATH, &app_path);

  DBusPendingCall *pending;
  dbus_connection_send_with_reply(adapter->signal_conn, msg, &pending, DBUS_TIMEOUT);
  dbus_message_unref(msg);

  dbus_pending_call_set_notify(pending, bare_bluetooth_linux__on_gatt_unregister_notify, call, NULL);
}

static void
bare_bluetooth_linux_gatt_characteristic_set_value(
  js_env_t *env, js_receiver_t, js_arraybuffer_span_of_t<bare_bluetooth_linux_adapter_t, 1> adapter, std::string char_path, js_typedarray_t<uint8_t> value
) {
  for (auto &svc : adapter->gatt_app.services) {
    for (auto &ch : svc.characteristics) {
      if (ch.path == char_path) {
        uint8_t *data;
        size_t len;
        int err = js_get_typedarray_info(env, value, data, len);
        assert(err == 0);

        ch.value.assign(data, data + len);
        return;
      }
    }
  }
}

static js_value_t *
bare_bluetooth_linux_exports(js_env_t *env, js_value_t *exports) {
  int err;

#define V(name, fn) \
  err = js_set_property<fn>(env, exports, name); \
  assert(err == 0);

  V("adapterInit", bare_bluetooth_linux_adapter_init)
  V("adapterDestroy", bare_bluetooth_linux_adapter_destroy)
  V("adapterGetPowered", bare_bluetooth_linux_adapter_get_powered)
  V("adapterSetPowered", bare_bluetooth_linux_adapter_set_powered)
  V("adapterGetDiscovering", bare_bluetooth_linux_adapter_get_discovering)
  V("adapterGetAddress", bare_bluetooth_linux_adapter_get_address)
  V("adapterSetDiscoveryFilter", bare_bluetooth_linux_adapter_set_discovery_filter)
  V("adapterStartDiscovery", bare_bluetooth_linux_adapter_start_discovery)
  V("adapterStopDiscovery", bare_bluetooth_linux_adapter_stop_discovery)

  V("deviceGetAddress", bare_bluetooth_linux_device_get_address)
  V("deviceGetName", bare_bluetooth_linux_device_get_name)
  V("deviceGetRSSI", bare_bluetooth_linux_device_get_rssi)
  V("deviceGetPaired", bare_bluetooth_linux_device_get_paired)
  V("deviceGetConnected", bare_bluetooth_linux_device_get_connected)
  V("deviceGetServicesResolved", bare_bluetooth_linux_device_get_services_resolved)
  V("deviceGetUUIDs", bare_bluetooth_linux_device_get_uuids)
  V("deviceGetManufacturerData", bare_bluetooth_linux_device_get_manufacturer_data)
  V("deviceGetServiceData", bare_bluetooth_linux_device_get_service_data)
  V("deviceConnect", bare_bluetooth_linux_device_connect)
  V("deviceDisconnect", bare_bluetooth_linux_device_disconnect)
  V("devicePair", bare_bluetooth_linux_device_pair)

  V("serviceIsPrimary", bare_bluetooth_linux_service_is_primary)

  V("charRead", bare_bluetooth_linux_char_read)
  V("charWrite", bare_bluetooth_linux_char_write)
  V("charStartNotify", bare_bluetooth_linux_char_start_notify)
  V("charStopNotify", bare_bluetooth_linux_char_stop_notify)
  V("charGetFlags", bare_bluetooth_linux_char_get_flags)
  V("charGetMTU", bare_bluetooth_linux_char_get_mtu)

  V("descRead", bare_bluetooth_linux_desc_read)
  V("descWrite", bare_bluetooth_linux_desc_write)
  V("descGetFlags", bare_bluetooth_linux_desc_get_flags)

  V("advertisementRegister", bare_bluetooth_linux_advertisement_register)
  V("advertisementUnregister", bare_bluetooth_linux_advertisement_unregister)

  V("gattServiceAdd", bare_bluetooth_linux_gatt_service_add)
  V("gattCharacteristicAdd", bare_bluetooth_linux_gatt_characteristic_add)
  V("gattRegister", bare_bluetooth_linux_gatt_register)
  V("gattUnregister", bare_bluetooth_linux_gatt_unregister)
  V("gattCharacteristicSetValue", bare_bluetooth_linux_gatt_characteristic_set_value)

#undef V

  return exports;
}

BARE_MODULE(bare_bluetooth_linux, bare_bluetooth_linux_exports)
