import os
import json
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS

app = Flask(__name__, static_folder='static', static_url_path='')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///instance/database.sqlite'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = 'uploads'
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(os.path.join(app.instance_path), exist_ok=True)


db = SQLAlchemy(app)
CORS(app)

# --- Models ---
class Operacion(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    subyacente = db.Column(db.String(50), nullable=False)
    fecha_entrada = db.Column(db.DateTime, default=datetime.utcnow)
    justificacion = db.Column(db.Text, nullable=True)
    estrategia_detectada = db.Column(db.String(100), nullable=True)
    legs = db.relationship('Leg', backref='operacion', lazy=True, cascade="all, delete-orphan")
    imagenes = db.relationship('Imagen', backref='operacion', lazy=True, cascade="all, delete-orphan")

class Leg(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    operacion_id = db.Column(db.Integer, db.ForeignKey('operacion.id'), nullable=False)
    accion = db.Column(db.String(10), nullable=False)  # COMPRA, VENTA
    tipo = db.Column(db.String(10), nullable=False)    # CALL, PUT
    cantidad = db.Column(db.Integer, nullable=False)
    vencimiento = db.Column(db.Date, nullable=False)
    strike = db.Column(db.Float, nullable=False)
    prima = db.Column(db.Float, nullable=False)

class Imagen(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    operacion_id = db.Column(db.Integer, db.ForeignKey('operacion.id'), nullable=False)
    path_archivo = db.Column(db.String(200), nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'operacion_id': self.operacion_id,
            'path_archivo': self.path_archivo
        }

# --- Strategy Recognition Logic ---
def reconocer_estrategia(legs_data):
    num_legs = len(legs_data)
    if not legs_data:
        return "Sin Legs"

    # Convert string dates to date objects for comparison
    for leg in legs_data:
        if isinstance(leg['vencimiento'], str):
            try:
                leg['vencimiento'] = datetime.strptime(leg['vencimiento'], '%Y-%m-%d').date()
            except ValueError:
                 # Handle cases where date might already be a date object or different format
                if not hasattr(leg['vencimiento'], 'year'): # Simple check if it's not date-like
                    return "Error en formato de fecha de vencimiento"


    # Check for same expiration date for multi-leg strategies (common case)
    mismo_vencimiento = True
    if num_legs > 1:
        primer_vencimiento = legs_data[0]['vencimiento']
        for leg in legs_data[1:]:
            if leg['vencimiento'] != primer_vencimiento:
                mismo_vencimiento = False
                break

    if num_legs == 1:
        leg = legs_data[0]
        if leg['accion'].upper() == "COMPRA":
            return f"Long {leg['tipo'].capitalize()}"
        elif leg['accion'].upper() == "VENTA":
            return f"Short {leg['tipo'].capitalize()}"

    if mismo_vencimiento:
        if num_legs == 2:
            leg1, leg2 = sorted(legs_data, key=lambda x: x['strike']), sorted(legs_data, key=lambda x: x['strike']) # ensure order if needed

            # Bull Call Spread: Compra Call (Strike A) + Venta Call (Strike B), A < B
            if (leg1['accion'].upper() == "COMPRA" and leg1['tipo'].upper() == "CALL" and
                leg2['accion'].upper() == "VENTA" and leg2['tipo'].upper() == "CALL" and
                leg1['strike'] < leg2['strike']):
                return "Bull Call Spread"

            # Bear Put Spread: Compra Put (Strike A) + Venta Put (Strike B), A < B
            # Note: Standard Bear Put Spread is Venta Put (lower strike) + Compra Put (higher strike)
            # User definition: Compra Put (A) + Venta Put (B), A < B. This means A is lower strike.
            # If A is bought and B is sold, and A < B, this is a Bear Put Spread.
            if (leg1['accion'].upper() == "COMPRA" and leg1['tipo'].upper() == "PUT" and
                leg2['accion'].upper() == "VENTA" and leg2['tipo'].upper() == "PUT" and
                leg1['strike'] < leg2['strike']): # User: A<B, Compra A, Venta B
                 return "Bear Put Spread"


            # Long Straddle: Compra Call (Strike A) + Compra Put (Strike A)
            if (leg1['tipo'].upper() == "CALL" and leg1['accion'].upper() == "COMPRA" and
                leg2['tipo'].upper() == "PUT" and leg2['accion'].upper() == "COMPRA" and
                leg1['strike'] == leg2['strike']):
                return "Long Straddle"

            # Long Strangle: Compra Call (Strike A) + Compra Put (Strike B), A != B
            # Need to check both are COMPRA, one CALL, one PUT, different strikes
            is_call_compra = (leg1['tipo'].upper() == "CALL" and leg1['accion'].upper() == "COMPRA") or \
                             (leg2['tipo'].upper() == "CALL" and leg2['accion'].upper() == "COMPRA")
            is_put_compra = (leg1['tipo'].upper() == "PUT" and leg1['accion'].upper() == "COMPRA") or \
                            (leg2['tipo'].upper() == "PUT" and leg2['accion'].upper() == "COMPRA")
            if is_call_compra and is_put_compra and leg1['strike'] != leg2['strike']:
                 # Ensure we have one of each type if strikes are different
                types_present = {l['tipo'].upper() for l in legs_data}
                if "CALL" in types_present and "PUT" in types_present:
                    return "Long Strangle"


        if num_legs == 4:
            # Iron Condor: Venta Put (A) + Compra Put (B) + Compra Call (C) + Venta Call (D), A < B < C < D
            # Sort by strike first, then by type (PUT then CALL for standard representation)
            sorted_legs = sorted(legs_data, key=lambda x: (x['strike'], x['tipo']))

            if len(sorted_legs) == 4:
                s_leg1, s_leg2, s_leg3, s_leg4 = sorted_legs

                is_iron_condor = (
                    s_leg1['accion'].upper() == "VENTA" and s_leg1['tipo'].upper() == "PUT" and
                    s_leg2['accion'].upper() == "COMPRA" and s_leg2['tipo'].upper() == "PUT" and
                    s_leg3['accion'].upper() == "COMPRA" and s_leg3['tipo'].upper() == "CALL" and
                    s_leg4['accion'].upper() == "VENTA" and s_leg4['tipo'].upper() == "CALL" and
                    s_leg1['strike'] < s_leg2['strike'] < s_leg3['strike'] < s_leg4['strike']
                )
                if is_iron_condor:
                    return "Iron Condor"

    return "Estrategia Personalizada"


# --- API Endpoints ---
@app.route('/api/operaciones', methods=['POST'])
def crear_operacion():
    try:
        data_str = request.form.get('data')
        if not data_str:
            return jsonify({"error": "Missing data field"}), 400

        data = json.loads(data_str)

        subyacente = data.get('subyacente')
        justificacion = data.get('justificacion')
        legs_data = data.get('legs')

        if not subyacente or not legs_data:
            return jsonify({"error": "Subyacente and legs are required"}), 400

        # Convert date strings to datetime objects for DB
        fecha_entrada_str = data.get('fecha_entrada')
        fecha_entrada = datetime.strptime(fecha_entrada_str, '%Y-%m-%dT%H:%M:%S.%fZ') if fecha_entrada_str else datetime.utcnow()


        estrategia = reconocer_estrategia(legs_data)

        nueva_operacion = Operacion(
            subyacente=subyacente,
            fecha_entrada=fecha_entrada,
            justificacion=justificacion,
            estrategia_detectada=estrategia
        )
        db.session.add(nueva_operacion)
        db.session.flush() # To get nueva_operacion.id for legs and images

        for leg_data in legs_data:
            vencimiento_date = datetime.strptime(leg_data['vencimiento'], '%Y-%m-%d').date()
            nuevo_leg = Leg(
                operacion_id=nueva_operacion.id,
                accion=leg_data['accion'].upper(),
                tipo=leg_data['tipo'].upper(),
                cantidad=int(leg_data['cantidad']),
                vencimiento=vencimiento_date,
                strike=float(leg_data['strike']),
                prima=float(leg_data['prima'])
            )
            db.session.add(nuevo_leg)

        # Handle image uploads
        if 'imagenes' in request.files:
            for f in request.files.getlist('imagenes'):
                if f.filename: # Check if a file was selected
                    filename = f.filename # In a real app, use secure_filename and ensure unique names
                    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                    f.save(filepath)
                    nueva_imagen = Imagen(operacion_id=nueva_operacion.id, path_archivo=filepath)
                    db.session.add(nueva_imagen)

        db.session.commit()

        return jsonify(operacion_to_dict(nueva_operacion)), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@app.route('/api/operaciones', methods=['GET'])
def obtener_operaciones():
    operaciones = Operacion.query.order_by(Operacion.fecha_entrada.desc()).all()

    # Group by expiration date (using the first leg's expiration for simplicity in grouping)
    # For a more robust grouping, you might need to decide how to handle strategies with mixed expirations
    # or if a primary expiration is defined. Here, we'll group by the earliest expiration date among legs.

    operaciones_data = []
    for op in operaciones:
        op_dict = operacion_to_dict(op)
        # Determine a representative expiration for grouping
        if op.legs:
            min_vencimiento = min(leg.vencimiento for leg in op.legs) if op.legs else None
            op_dict['vencimiento_grupo'] = min_vencimiento.strftime('%Y-%m-%d') if min_vencimiento else "N/A"
        else:
            op_dict['vencimiento_grupo'] = "N/A" # Should not happen if legs are required
        operaciones_data.append(op_dict)

    # Group by 'vencimiento_grupo'
    grouped_operaciones = {}
    for op_data in operaciones_data:
        v_grupo = op_data['vencimiento_grupo']
        if v_grupo not in grouped_operaciones:
            grouped_operaciones[v_grupo] = []
        grouped_operaciones[v_grupo].append(op_data)

    return jsonify(grouped_operaciones)


@app.route('/api/operaciones/<int:id>', methods=['GET'])
def obtener_operacion(id):
    operacion = Operacion.query.get_or_404(id)
    return jsonify(operacion_to_dict(operacion))

@app.route('/api/operaciones/<int:id>', methods=['DELETE'])
def eliminar_operacion(id):
    operacion = Operacion.query.get_or_404(id)

    # Delete associated images from filesystem
    for img in operacion.imagenes:
        if os.path.exists(img.path_archivo):
            try:
                os.remove(img.path_archivo)
            except OSError as e:
                # Log this error, but continue deletion from DB
                print(f"Error deleting file {img.path_archivo}: {e}")

    db.session.delete(operacion)
    db.session.commit()
    return jsonify({"mensaje": "Operación eliminada exitosamente"}), 200

# --- Helper to convert Operacion to dict ---
def operacion_to_dict(operacion):
    return {
        "id": operacion.id,
        "subyacente": operacion.subyacente,
        "fecha_entrada": operacion.fecha_entrada.isoformat() + "Z", # ISO format for JS
        "justificacion": operacion.justificacion,
        "estrategia_detectada": operacion.estrategia_detectada,
        "legs": [leg_to_dict(leg) for leg in operacion.legs],
        "imagenes": [img.to_dict() for img in operacion.imagenes]
    }

def leg_to_dict(leg):
    return {
        "id": leg.id,
        "accion": leg.accion,
        "tipo": leg.tipo,
        "cantidad": leg.cantidad,
        "vencimiento": leg.vencimiento.strftime('%Y-%m-%d'),
        "strike": leg.strike,
        "prima": leg.prima
    }

# Serve frontend
@app.route('/')
def index():
    return send_from_directory('templates', 'index.html')

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True)
