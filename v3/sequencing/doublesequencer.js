define(function(require) {

    const Interval = require("../util/interval");
    const util = require("../util/util");
    const motionutils = require("../util/motionutils");
    const eventify = require("../util/eventify");
    const Schedule = require("./schedule");



    class DoubleSequencer {

        constructor (axis, toA, toB) {
            this._axis = axis;
            this._toA = toA;
            this._toB = toB;

            // readiness
            this._ready = new eventify.EventBoolean(false, {init:true});
            this._toB_ready = false;
            this._toA_ready = false;

            // schedules
            this._scheduleA;
            this._scheduleB;

            // activeCues
            this._activeCues = new Map(); // (key -> cue)

            // Register axis callback
            this._handle = this._axis.add_callback(this._onAxisUpdate.bind(this));

            /*

            Wrap onTimingUpdate

            To allow multiple instances of ActiveCues to subscribe to
            the same event source, the handler must be different objects.
            If we use the class method directly as handler, it will
            be on the prototype and therefor be shared between instances.

            It is safe to use the same handler for multiple event sources.

            Additionally we specify a context for the handler simply to
            be able to use 'this' safely inside the wrapper implementation.

            Since the same wrapper is registered with two distinct
            event sources (timing objects), we use 'eInfo.src' to distinguish
            between them.

            */

            this._onTimingUpdateWrapper = function (eInfo) {
                let to = eInfo.src;
                let new_vector;
                // check and set sequencer readiness
                if (!this._ready.value) {
                    if (to == this._toA) {
                        this._toA_ready = true;
                        this._scheduleA = new Schedule(to.clock, to.range,
                                                       this._axis, this._onCallback);
                    } else if (to == this._toB) {
                        this._toB_ready = true;
                        this._scheduleB = new Schedule(to.clock, to.range,
                                                       this._axis, this._onCallback);
                    }
                    if (this._toA_ready && this._toB_ready) {
                        this._ready.value = true;
                    }
                }

                /*
                    If update is the initial vector from the timing object,
                    we set current time as the official time for the update.
                    Else, the new vector is "live" and we use the timestamp
                    when it was created as the official time for the update.
                    This is represented by the new_vector.
                */
                if (eInfo.init) {
                    new_vector = motionutils.calculateVector(to.vector, to.clock.now());
                } else {
                    new_vector = to.vector;
                }

                if (this.isReady()) {
                    this._onTimingUpdate(to, new_vector);
                }
            };
            this._toA.on("change", this._onTimingUpdateWrapper, this);
            this._toB.on("change", this._onTimingUpdateWrapper, this);

            // Schedule Callback
            this._onCallback = function(eList, src) {
                this._onScheduleCallback(eList, src);
            }.bind(this);

            // Change event
            eventify.eventifyInstance(this, {init:false}); // no events type
            this.eventifyDefineEvent("change", {init:true});
        }

        /*
            Eventify: callback formatter
        */
        eventifyCallbackFormatter = function (type, e, eInfo) {
            return [e, eInfo];
        };

        /*
            Eventify: immediate events
        */
        eventifyMakeInitEvents = function (type) {
            if (type === "change") {
                if (this.isReady()) {
                    let changeMap = [...this._activeCues.values()].map(cue => {
                        return [cue.key, {new:cue, old:undefined}];
                    });
                    return [changeMap];
                }
            }
            return [];
        };


        /*
            Sequencer Ready Promise
        */
        get ready () {
            return eventify.makeEventPromise(this._ready, true);
        };

        /*
            Sequencer Read State
        */
        isReady() {
            return this._ready.value;
        }


        /*
            Handling Axis Update Callbacks
        */
        _onAxisUpdate(batchMap) {
            // Do something
            console.log("onAxisUpdate");
        }

        /*
            Handling Change Events from Timing Objects
        */
        _onTimingUpdate (to, new_vector) {
            const PosDelta = motionutils.MotionDelta.PosDelta;
            const MoveDelta = motionutils.MotionDelta.MoveDelta;
            const other_to = (to == this._toA) ? this._toB : this._toA;

            if (to == this._toA) {
                console.log("update toA");
            }
            if (to == this._toB) {
                console.log("update toB");

            }


            /*
                Sample the state of the other timing object at same time.
            */
            let ts = new_vector.timestamp;
            let other_new_vector = motionutils.calculateVector(other_to.vector, ts);


            /*
                The nature of the vector change
            */
            let delta = new motionutils.MotionDelta(to.old_vector, new_vector);

            /*
                Jump
            */

            let activeCues, enterCues, exitCues;


            if (delta.posDelta == PosDelta.CHANGE) {
                console.log("jump");
                // make position interval
                let low = Math.min(new_vector.position, other_new_vector.position);
                let high = Math.max(new_vector.position, other_new_vector.position);
                let itv = new Interval(low, high, true, true);


                // new active cues
                activeCues = new Map(this._axis.lookup(itv).map(cue => {
                    return [cue.key, cue];
                }));
                // exit cues - in old activeCues but not in new activeCues
                exitCues = util.map_difference(this._activeCues, activeCues);
                // enter cues - not in old activeCues but in new activeCues
                enterCues = util.map_difference(activeCues, this._activeCues);
            }

            /*
                Moving
            */

            // kick off schedule

            // TODO - need to kick off the other as well
            if (to == this._toA) {
                this._scheduleA.setVector(new_vector);
            } else if (to == this._toB) {
                this._scheduleB.setVector(new_vector);
            }



            // update active cues
            this._activeCues = activeCues;


            // make change Map
            let changeMap = new Map();
            for (let cue of exitCues.values()) {
                changeMap.set(cue.key, {new:undefined, old:cue});
            }
            for (let cue of enterCues.values()) {
                changeMap.set(cue.key, {new:cue, old:undefined});
            }

            // event notification
            this.eventifyTriggerEvent("change", changeMap);
        };





        /*
            Handling due Events from Schedules
        */
        _onScheduleCallback = function(dueEvens, schedule) {
            if (schedule == this._scheduleA) {
                console.log("schedule A callback");
            } else if (schedule == this._scheduleB) {
                console.log("schedule B callback");
            }
        }


        /*
            Map accessors
        */

        has(key) {
            return this._activeCues.has(key);
        };

        get(key) {
            return this._activeCues.get(key);
        };

        keys() {
            return this._activeCues.keys();
        };

        values() {
            return this._activeCues.values();
        };

        entries() {
            return this._activeCues.entries();
        }

    }

    eventify.eventifyPrototype(DoubleSequencer.prototype);

    return DoubleSequencer;

});
