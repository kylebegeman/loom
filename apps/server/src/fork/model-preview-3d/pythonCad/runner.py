"""Loom's isolated CAD protocol. inspect/probe never execute workspace code."""
import ast
import contextlib
import importlib.metadata
import importlib.util
import inspect
import io
import json
import math
import os
from pathlib import Path
import platform
import struct
import sys
import traceback
import warnings

# Model imports must not create or rewrite bytecode caches in the workspace.
sys.dont_write_bytecode = True


def literal(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def annotation_name(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return ""


def parameter_type(node, default):
    metadata, options = {}, None
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        node = ast.parse(node.value, mode="eval").body
    if isinstance(node, ast.Subscript) and annotation_name(node.value) == "Annotated":
        items = node.slice.elts if isinstance(node.slice, ast.Tuple) else [node.slice]
        node = items[0]
        for item in items[1:]:
            value = ast.literal_eval(item)
            if isinstance(value, dict):
                metadata.update(value)
    name = annotation_name(node)
    if name in ("int", "float", "str", "bool"):
        kind = {"int": "number", "float": "number", "str": "string", "bool": "boolean"}[name]
        if name == "int":
            metadata.setdefault("step", 1)
    elif isinstance(node, ast.Subscript) and annotation_name(node.value) == "Literal":
        items = node.slice.elts if isinstance(node.slice, ast.Tuple) else [node.slice]
        values = [ast.literal_eval(item) for item in items]
        if not values or not all(type(v) is type(values[0]) for v in values):
            raise ValueError("Literal choices must share one type")
        if type(values[0]) in (int, float):
            kind = "number"
        elif type(values[0]) is str:
            kind = "string"
        elif type(values[0]) is bool:
            kind = "boolean"
        else:
            raise ValueError("Unsupported Literal choices")
        labels = metadata.get("labels", {})
        options = [{"value": literal(v), "label": str(labels.get(v, str(v)))} for v in values]
    elif isinstance(node, ast.Subscript) and annotation_name(node.value) in ("tuple", "Tuple", "list", "List"):
        items = node.slice.elts if isinstance(node.slice, ast.Tuple) else [node.slice]
        if not all(annotation_name(v) in ("float", "int") or isinstance(v, ast.Constant) and v.value is Ellipsis for v in items):
            raise ValueError("Vectors need numeric annotations")
        kind = "vector"
    elif node is None:
        if type(default) in (int, float):
            kind = "number"
            if type(default) is int:
                metadata.setdefault("step", 1)
        elif type(default) is bool:
            kind = "boolean"
        elif type(default) is str:
            kind = "string"
        elif isinstance(default, (tuple, list)) and all(type(v) in (int, float) for v in default):
            kind = "vector"
        else:
            raise ValueError("Unsupported default")
    else:
        raise ValueError("Unsupported annotation")
    valid = {"number": type(default) in (int, float), "string": type(default) is str,
             "boolean": type(default) is bool,
             "vector": isinstance(default, (list, tuple)) and all(type(v) in (int, float) for v in default)}
    if not valid[kind]:
        raise ValueError("Default does not match annotation")
    value = literal(default)
    range_value = None
    if "min" in metadata and "max" in metadata:
        minimum, maximum, step = metadata["min"], metadata["max"], metadata.get("step")
        if not all(type(v) in (int, float) and math.isfinite(v) for v in [minimum, maximum] + ([] if step is None else [step])):
            raise ValueError("Range values must be finite numbers")
        if minimum > maximum or step is not None and step <= 0:
            raise ValueError("Invalid range")
        range_value = {"min": minimum, "max": maximum, "step": step}
    return {"kind": kind, "defaultValue": value, "range": range_value, "options": options,
            "group": str(metadata.get("group", "")),
            "description": str(metadata["description"]) if "description" in metadata else None}


def inspect_source(source, text=None):
    tree = ast.parse(text if text is not None else Path(source).read_text(encoding="utf-8"), filename=source)
    model = next((node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "model"), None)
    if model is None:
        return {"ok": False, "parameters": [], "log": [{"level": "error", "text": "Define a module-level def model(...) function."}]}
    parameters, log = [], []
    positional = model.args.posonlyargs + model.args.args
    defaults = [None] * (len(positional) - len(model.args.defaults)) + model.args.defaults
    pairs = list(zip(positional, defaults)) + list(zip(model.args.kwonlyargs, model.args.kw_defaults))
    for argument, default in pairs:
        try:
            if argument in model.args.posonlyargs:
                raise ValueError("Positional-only parameters are unsupported")
            if default is None:
                raise ValueError("A literal default is required")
            value = ast.literal_eval(default)
            parameters.append({"name": argument.arg, **parameter_type(argument.annotation, value)})
        except (ValueError, TypeError, SyntaxError, KeyError) as exc:
            log.append({"level": "warning", "text": f"Skipped {argument.arg}: {exc}"})
    if model.args.vararg or model.args.kwarg:
        log.append({"level": "warning", "text": "Variadic parameters are not exposed in the customizer."})
    return {"ok": True, "parameters": parameters, "log": log}


def under(root, candidate):
    try:
        Path(candidate).resolve().relative_to(root)
        return True
    except (ValueError, TypeError, OSError):
        return False


def escape_dep(value):
    return str(value).replace("\\", "\\\\").replace(" ", "\\ ").replace("#", "\\#").replace("$", "\\$").replace(":", "\\:")


def load_shape(request, log):
    import build123d as cad
    source = Path(request["source"]).resolve()
    root = Path(request["root"]).resolve()
    opened = set()
    revisions = {}
    def audit(event, args):
        if event == "open" and args and isinstance(args[0], (str, bytes, os.PathLike)) and under(root, args[0]):
            candidate = str(Path(args[0]).resolve())
            if candidate.endswith(".pyc"):
                try:
                    candidate = importlib.util.source_from_cache(candidate)
                except ValueError:
                    return
            opened.add(candidate)
            try:
                st = os.stat(candidate)
                revisions.setdefault(candidate, (st.st_size, st.st_mtime_ns, st.st_ino))
            except OSError:
                pass
    sys.addaudithook(audit)
    sys.path.insert(0, str(source.parent))
    sys.path.insert(1, str(root))
    specification = importlib.util.spec_from_file_location("_loom_cad_model", source)
    module = importlib.util.module_from_spec(specification)
    sys.modules[specification.name] = module
    specification.loader.exec_module(module)
    function = getattr(module, "model", None)
    if not callable(function):
        raise ValueError("Define a module-level def model(...) function.")
    values = {name: json.loads(value) for name, value in request.get("values", {}).items()}
    signature = inspect.signature(function)
    for name in list(values):
        if name not in signature.parameters:
            values.pop(name)
            log.append({"level": "warning", "text": f"Skipped unknown parameter {name}"})
    shape = function(**values)
    if isinstance(shape, cad.Builder):
        shape = getattr(shape, "part", None)
    if isinstance(shape, (list, tuple)):
        shape = cad.Compound(children=list(shape))
    if not isinstance(shape, cad.Shape):
        raise TypeError("model() must return a Shape, a BuildPart, or a list of shapes.")
    for candidate, revision in revisions.items():
        st = os.stat(candidate)
        if revision != (st.st_size, st.st_mtime_ns, st.st_ino):
            raise ValueError("Model inputs changed during rendering. Refresh preview to render the latest version.")
    dependencies = opened | {str(Path(m.__file__).resolve()) for m in list(sys.modules.values()) if getattr(m, "__file__", None) and under(root, m.__file__)}
    if request.get("depsPath"):
        Path(request["depsPath"]).write_text(escape_dep(request["output"]) + ": " + " ".join(escape_dep(p) for p in sorted(dependencies)) + "\n", encoding="utf-8")
    return shape


def export_shape(shape, request, log):
    import build123d as cad
    output, form = request["output"], request.get("format", "stl")
    linear, angular = request.get("linear", 0.01), request.get("angular", 0.1)
    facets, vertices = None, None
    if request["command"] == "export-step":
        cad.export_step(shape, output)
    elif form == "3mf":
        mesher = cad.Mesher()
        mesher.add_shape(shape, linear_deflection=linear, angular_deflection=angular)
        mesher.write(output)
        facets = sum(mesher.triangle_counts)
        vertices = sum(mesher.vertex_counts)
    else:
        cad.export_stl(shape, output, tolerance=linear, angular_tolerance=angular, ascii_format=False)
        with open(output, "rb") as mesh:
            header = mesh.read(84)
            if len(header) == 84:
                facets = struct.unpack("<I", header[80:84])[0]
    valid = shape.is_valid
    if not valid:
        log.append({"level": "warning", "text": "The shape is not a valid solid."})
    box = shape.bounding_box()
    def xyz(point):
        return [point.X, point.Y, point.Z]
    return {"manifold": bool(shape.is_manifold), "facets": facets, "vertices": vertices,
            "boundingBox": {"min": xyz(box.min), "max": xyz(box.max)}}


class BoundedOutput(io.StringIO):
    def write(self, text):
        remaining = 256 * 1024 - self.tell()
        if remaining > 0:
            super().write(text[:remaining])
        return len(text)


def main(request, command):
    request["command"] = command
    if command == "probe":
        try:
            version = importlib.metadata.version("build123d")
        except importlib.metadata.PackageNotFoundError:
            version = None
        return {"ok": True, "python": platform.python_version(), "build123d": version, "log": []}
    if command == "inspect":
        return inspect_source(request["source"], request.get("sourceText"))
    log, printed = [], BoundedOutput()
    try:
        with contextlib.redirect_stdout(printed), warnings.catch_warnings(record=True) as caught:
            if command == "tessellate":
                import build123d as cad
                shape = cad.import_step(request["source"])
            elif command in ("render", "export-step"):
                shape = load_shape(request, log)
            else:
                raise ValueError("Unknown runner command")
            summary = export_shape(shape, request, log)
            log += [{"level": "warning", "text": str(item.message)} for item in caught]
        log += [{"level": "echo", "text": line} for line in printed.getvalue().splitlines()]
        return {"ok": True, "summary": summary, "log": log}
    except Exception as exc:
        frames = traceback.extract_tb(exc.__traceback__)
        frame = next((f for f in reversed(frames) if under(Path(request.get("root", Path(request["source"]).parent)).resolve(), f.filename)), None)
        prefix = f"{frame.filename}:{frame.lineno}: " if frame else ""
        log += [{"level": "echo", "text": line} for line in printed.getvalue().splitlines()]
        log.append({"level": "error", "text": f"{prefix}{type(exc).__name__}: {exc}"})
        log += [{"level": "trace", "text": line} for line in traceback.format_exc().splitlines()]
        return {"ok": False, "log": log}


if __name__ == "__main__":
    request = json.load(sys.stdin)
    try:
        result = main(request, sys.argv[1])
    except Exception as exc:
        result = {"ok": False, "log": [{"level": "error", "text": f"{type(exc).__name__}: {exc}"}]}
    result["log"] = [{**row, "text": row["text"][:8192]} for row in result.get("log", [])[-500:]]
    Path(request["resultPath"]).write_text(literal(result), encoding="utf-8")
    sys.exit(0 if result.get("ok") else 1)
