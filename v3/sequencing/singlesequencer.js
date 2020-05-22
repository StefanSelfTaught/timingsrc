/*
    Copyright 2020
    Author : Ingar Arntzen

    This file is part of the Timingsrc module.

    Timingsrc is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Timingsrc is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with Timingsrc.  If not, see <http://www.gnu.org/licenses/>.
*/

define(function(require) {

    const util = require("../util/util");
    const endpoint = require("../util/endpoint");
    const Interval = require("../util/interval");
    const motionutils = require("../util/motionutils");
    const eventify = require("../util/eventify");
    const Schedule = require("./schedule");
    const Axis = require("./axis");

    const Delta = Axis.Delta;
    const PosDelta = motionutils.MotionDelta.PosDelta;
    const MoveDelta = motionutils.MotionDelta.MoveDelta;
    const Relation = Interval.Relation;
    const isMoving = motionutils.isMoving;
    const Match = [
        Relation.OVERLAP_LEFT,
        Relation.COVERED,
        Relation.EQUAL,
        Relation.COVERS,
        Relation.OVERLAP_RIGHT
    ]

    function isNoop(delta) {
        return (delta.interval == Delta.NOOP && delta.data == Delta.NOOP);
    }


    class SingleSequencer {

        constructor (axis, to) {

            // axis
            this._axis = axis;

            // timing object
            this._to = to;

            // schedule
            this._sched = new Schedule(this._axis, to);

            // activeCues
            this._activeCues = new Map(); // (key -> cue)

            // Axis Callback
            let cb = this._onAxisCallback.bind(this)
            this._axis_cb = this._axis.add_callback(cb);

            // Schedule Callback
            cb = this._onScheduleCallback.bind(this);
            this._sched_cb = this._sched.add_callback(cb)


            /*

            Wrap onTimingChange

            To allow multiple instances of SingleSequencer to subscribe to
            the same event source, the handler must be different objects.
            If we use the class method directly as handler, it will
            be on the prototype and therefor be shared between instances.

            It is safe to use the same handler for multiple event sources.

            Additionally we specify a context for the handler simply to
            be able to use 'this' safely inside the wrapper implementation.

            */

            this._onTimingCallbackWrapper = function (eInfo) {
                this._onTimingCallback(eInfo);
            };
            this._to.on("change", this._onTimingCallbackWrapper.bind(this));

            // Change event
            eventify.eventifyInstance(this, {init:false}); // no events type
            this.eventifyDefineEvent("change", {init:true});
        }


        /***************************************************************
         EVENTS
        ***************************************************************/

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
                    if (this._activeCues.size == 0) {
                        return [];
                    }
                    let changeMap = [...this._activeCues.values()].map(cue => {
                        return [cue.key, {new:cue, old:undefined}];
                    });
                    return [changeMap];
                }
            }
            return [];
        };


        /***************************************************************
         READINESS
        ***************************************************************/

        /*
            Sequencer Ready Promise
        */
        get ready () {
            return this._to.ready;
        };

        /*
            Sequencer Read State
        */
        isReady() {
            return this._to.isReady();
        }


        /***************************************************************
         AXIS CALLBACK
        ***************************************************************/

        /*
            make exit, change and enter events
            - uses axis.lookup
        */
        _get_events_from_axis_lookup(eventMap, position, approach1) {

            /*
                Active cues

                find new set of active cues by querying the axis
            */
            const pos = new Interval(position);
            const activeCues = new Map(this._axis.lookup(pos).map(function(cue) {
                return [cue.key, cue];
            }));

            let first = this._activeCues.size == 0;

            let changeEvents = [];
            let exitEvents = [];


            if (!first){

                /*
                    Change Events

                    change cues - cues which are modified, yet remain active cues
                */
                let remainCues = util.map_intersect(this._activeCues, activeCues);


                /*
                    Two approaches

                    1) large eventMap
                    eventMap larger than remainCues
                    - iterate remainCues
                    - keep those that are found in eventMap

                    2) large remainCues
                    remainCues larger than eventMap
                    - iterate eventMap
                    - keep those that are found in remainCues
                */

                if (approach1) {
                    /*
                        approach 1) - large eventMap
                    */
                    let item, _item;
                    for (let cue of remainCues.values()) {
                        item = eventMap.get(cue.key);
                        if (item !== undefined && !isNoop(item.delta)) {
                            _item = {key:item.key, new:item.new, old:item.old};
                            changeEvents.push(_item);
                        }
                    }
                } else {
                    /*
                        approach 2) - large remainCues
                    */
                    let cue, _item;
                    for (let item of eventMap.values()) {
                        cue = remainCues.get(item.key);
                        if (cue != undefined && !isNoop(item.delta)) {
                            _item = {key:item.key, new:item.new, old:item.old};
                            changeEvents.push(_item);
                        }
                    }
                }

                /*
                    Exit Events
                    exit cues were in old active cues - but not in new
                */
                let exitCues = util.map_difference(this._activeCues, activeCues);
                exitEvents = [...exitCues.values()]
                    .map(cue => {
                        return {key:cue.key, new:undefined, old:cue};
                    });
            }

            /*
                Enter Events
                enter cues were not in old active cues - but are in new
            */
            let enterCues;
            if (first) {
                enterCues = activeCues
            } else {
                enterCues = util.map_difference(activeCues, this._activeCues);
            }
            let enterEvents = [...enterCues.values()]
                .map(cue => {
                    return {key:cue.key, new:cue, old:undefined};
                });

            return [exitEvents, changeEvents, enterEvents];
        }

        /*
            make exit, change and enter events
            - uses axis eventMap
        */
        _get_events_from_axis_events(eventMap, position) {
            const enterEvents = [];
            const changeEvents = [];
            const exitEvents = [];
            let is_active, should_be_active, _item;
            const first = this._activeCues.size == 0;
            for (let item of eventMap.values()) {
                if (isNoop(item.delta)) {
                    return;
                }
                // exit, change, enter events
                is_active = (first) ? false : this._activeCues.has(item.key);
                should_be_active = false;
                if (item.new != undefined) {
                    if (item.new.interval.covers_endpoint(position)) {
                        should_be_active = true;
                    }
                }
                if (is_active && !should_be_active) {
                    // exit
                    _item = {key:item.key, new:undefined, old:item.old};
                    exitEvents.push(_item);
                } else if (!is_active && should_be_active) {
                    // enter
                    _item = {key:item.key, new:item.new, old:undefined};
                    enterEvents.push(_item);
                } else if (is_active && should_be_active) {
                    // change
                    _item = {key:item.key, new:item.new, old:item.old};
                    changeEvents.push(_item);
                }
            };
            return [exitEvents, changeEvents, enterEvents];
        }


        _onAxisCallback(eventMap) {
            //console.log("onAxisCallback");
            /*
                process axis events which are relevant to the set
                of activeCues, or to the immediate future (schedule)

                enterCues - inactive -> active
                changeCues - active -> active, but changed
                exitCues - active -> inactive

                Two approaches
                - 1) filter list of events - compare to current active cues
                - 2) regenerate new activeCues from
                     axis, compare it to current active cues

                Preferred method depends on length of events.
            */
            const now = this._to.clock.now();
            const now_vector = motionutils.calculateVector(this._to.vector, now);


            let res;
            let t0, d1, d2, d3;

            t0 = performance.now();
            let res1 = this._get_events_from_axis_events(eventMap, now_vector.position);
            d1 = (performance.now() - t0).toFixed(3);

            t0 = performance.now();
            let res2 = this._get_events_from_axis_lookup(eventMap, now_vector.position, true);
            d2 = (performance.now() - t0).toFixed(3);

            t0 = performance.now();
            let res3 = this._get_events_from_axis_lookup(eventMap, now_vector.position, false);
            d3 = (performance.now() - t0).toFixed(3);

            console.log(d1, d2, d3)

            // check correctness
            let [exitEvents1, changeEvents1, enterEvents1] = res1;
            let [exitEvents2, changeEvents2, enterEvents2] = res2;
            let [exitEvents3, changeEvents3, enterEvents3] = res3;

            let exitKeys1 = new Set([...exitEvents1].map(item => item.key))
            let exitKeys2 = new Set([...exitEvents2].map(item => item.key))
            let exitKeys3 = new Set([...exitEvents3].map(item => item.key))

            let changeKeys1 = new Set([...changeEvents1].map(item => item.key))
            let changeKeys2 = new Set([...changeEvents2].map(item => item.key))
            let changeKeys3 = new Set([...changeEvents3].map(item => item.key))

            let enterKeys1 = new Set([...enterEvents1].map(item => item.key))
            let enterKeys2 = new Set([...enterEvents2].map(item => item.key))
            let enterKeys3 = new Set([...enterEvents3].map(item => item.key))

            let cmp_exit_1_2 = util.eqSet(exitKeys1, exitKeys2)
            let cmp_exit_1_3 = util.eqSet(exitKeys1, exitKeys3)
            let cmp_exit_2_3 = util.eqSet(exitKeys2, exitKeys3)

            let cmp_change_1_2 = util.eqSet(changeKeys1, changeKeys2)
            let cmp_change_1_3 = util.eqSet(changeKeys1, changeKeys3)
            let cmp_change_2_3 = util.eqSet(changeKeys2, changeKeys3)

            let cmp_enter_1_2 = util.eqSet(enterKeys1, enterKeys2)
            let cmp_enter_1_3 = util.eqSet(enterKeys1, enterKeys3)
            let cmp_enter_2_3 = util.eqSet(enterKeys2, enterKeys3)

            if (!cmp_exit_1_2) {
                console.log("exit 1 2 differs");
                /*
                console.log("exitKeys 1");
                console.log(exitKeys1);
                console.log("exitKeys 2");
                console.log(exitKeys2);
                */
            }
            if (!cmp_exit_1_3) {
                console.log("exit 1 3 differs");
                /*
                console.log("exitKeys 1");
                console.log(exitKeys1);
                console.log("exitKeys 3");
                console.log(exitKeys3);
                */
            }
            if (!cmp_exit_2_3) {
                console.log("exit 2 3 differs");
                /*
                console.log("exitKeys 2");
                console.log(exitKeys2);
                console.log("exitKeys 3");
                console.log(exitKeys3);
                */
            }


            if (!cmp_change_1_2) {
                console.log("change 1 2 differs");
            }
            if (!cmp_change_1_3) {
                console.log("change 1 3 differs");
            }
            if (!cmp_change_2_3) {
                console.log("change 2 3 differs");
            }

            if (!cmp_enter_1_2) {
                console.log("enter 1 2 differs");

                /*
                console.log("enterKeys 1");
                console.log(enterKeys1);
                console.log("enterKeys 2");
                console.log(enterKeys2);
                */
            }
            if (!cmp_enter_1_3) {
                console.log("enter 1 3 differs");

                /*
                console.log("enterKeys 1");
                console.log(enterKeys1);
                console.log("enterKeys 3");
                console.log(enterKeys3);
                */
            }
            if (!cmp_enter_2_3) {
                console.log("enter 2 3 differs");

                /*
                console.log("enterKeys 2");
                console.log(enterKeys2);
                console.log("enterKeys 3");
                console.log(enterKeys3);
                */
            }


            const [exitEvents, changeEvents, enterEvents] = res3;

            // update activeCues
            exitEvents.forEach(item => {
                this._activeCues.delete(item.key);
            });
            enterEvents.forEach(item => {
                this._activeCues.set(item.key, item.new);
            });

            // notifications
            const events = exitEvents;
            events.push(...changeEvents);
            events.push(...enterEvents);

            // event notification
            if (events.length > 0) {
                this.eventifyTriggerEvent("change", events);
            }

            // clear schedule
            this._sched.setVector(now_vector);


            /*
                Clear and reset schedule if necessary.

                This is only necessary if any of the cues intervals
                are changed, and that these changes are relevant
                with respect to the posInterval of scheduler.
                - new interval match posInterval
                - old interval match posInterval

                There is no change in motion at this time, so either we
                continue moving or we continue paused.

                corner case - if motion is available and moving -
                yet the sheduler has not been started yet,
                sched.posInterval will be undefined. Not sure if this is
                possible, but if it were to occur we dont do anything
                and trust that the schedule will be started shortly
                by onTimingCallback.
            */
            /*
            if (isMoving(now_vector) && this._sched.posInterval) {
                let sched_dirty = false;
                let rel, item;
                let delta;
                for (let i=0; i<events.length; i++) {
                    item = events[i];
                    delta = item.delta;
                    if (delta.interval == Delta.NOOP) {
                        continue;
                    }
                    // check item.new.interval
                    if (item.new != undefined) {
                        rel = item.new.interval.compare(this._sched.posInterval);
                        if (Match.includes(rel)) {
                            sched_dirty = true;
                            break;
                        }
                    }
                    // check item.old.interval
                    if (item.old != undefined) {
                        rel = item.old.interval.compare(this._sched.posInterval);
                        if (Match.includes(rel)) {
                            sched_dirty = true;
                            break;
                        }
                    }
                }
                if (sched_dirty) {
                    this._sched.setVector(now_vector);
                }
            }
            */
        }


        /***************************************************************
         TIMING OBJECT CALLBACK
        ***************************************************************/

        _onTimingCallback (eInfo) {
            //console.log("onTimingCallback");
            const events = [];

            /*
                If update is the initial vector from the timing object,
                we set current time as the official time for the update.
                Else, the new vector is "live" and we use the timestamp
                when it was created as the official time for the update.
                This is represented by the new_vector.
            */
            let new_vector;
            if (eInfo.init) {
                new_vector = motionutils.calculateVector(to.vector, to.clock.now());
            } else {
                new_vector = to.vector;
            }

            /*
                The nature of the vector change
            */
            let delta = new motionutils.MotionDelta(to.old_vector, new_vector);

            /*
                Reevaluate active state.
                This is required after any discontinuity of the position (jump),
                or if the motion stopped without jumping (pause or halt at range
                restriction)
            */
            if (delta.posDelta == PosDelta.CHANGE || delta.moveDelta == MoveDelta.STOP) {
                // make position interval
                let low = new_vector.position;
                let high = new_vector.position;
                let itv = new Interval(low, high, true, true);
                // new active cues
                let activeCues = new Map(this._axis.lookup(itv).map(cue => {
                    return [cue.key, cue];
                }));
                // exit cues - in old activeCues but not in new activeCues
                let exitCues = util.map_difference(this._activeCues, activeCues);
                // enter cues - not in old activeCues but in new activeCues
                let enterCues = util.map_difference(activeCues, this._activeCues);
                // update active cues
                this._activeCues = activeCues;
                // make events
                for (let cue of exitCues.values()) {
                    events.push({key:cue.key, new:undefined, old:cue});
                }
                for (let cue of enterCues.values()) {
                    events.push({key:cue.key, new:cue, old:undefined});
                }
                // event notification
                if (events.length > 0 ) {
                    this.eventifyTriggerEvent("change", events);
                }
            }

            /*
                Handle Timing Object Moving
            */
            this._sched.setVector(new_vector);
        };


        /***************************************************************
         SCHEDULE CALLBACK
        ***************************************************************/

        _onScheduleCallback = function(endpointItems) {
            const events = [];
            endpointItems.forEach(function (item) {
                let cue = item.cue;
                let has_cue = this._activeCues.has(cue.key);
                let [value, right, closed, singular] = item.endpoint;
                if (singular) {
                    if (has_cue) {
                        // exit
                        events.push({key:cue.key, new:undefined, old:cue});
                        this._activeCues.delete(cue.key);
                    } else {
                        // enter
                        events.push({key:cue.key, new:cue, old:undefined});
                        // exit
                        events.push({key:cue.key, new:undefined, old:cue});
                        // no need to both add and remove from activeCues
                    }
                } else {
                    // enter or exit
                    let right_value = (right) ? -1 : 1;
                    let enter = (item.direction * right_value) > 0;
                    if (enter) {
                        if (!has_cue) {
                            // enter
                            events.push({key:cue.key, new:cue, old:undefined});
                            this._activeCues.set(cue.key, cue);
                        }
                    } else {
                        if (has_cue) {
                            // exit
                            events.push({key:cue.key, new:undefined, old:cue});
                            this._activeCues.delete(cue.key);
                        }
                    }
                }
            }, this);

            // event notification
            if (events.length > 0) {
                this.eventifyTriggerEvent("change", events);
            }
        };


        /***************************************************************
         MAP ACCESSORS
        ***************************************************************/

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

    eventify.eventifyPrototype(SingleSequencer.prototype);

    return SingleSequencer;

});

